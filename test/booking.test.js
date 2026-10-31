import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { database, serve, request } from './helpers.js';
let pool, server, peer;
let peerState='operational';
const equipmentId=randomUUID();
const day=offset=>new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
const body=(offset=5)=>({equipmentId,date:day(offset),slot:'AM',requester:'Asha Sen',purpose:'Department meeting'});
before(async()=>{
  pool=await database();
  const stub=express();stub.get('/api/equipment/:id',async(req,res)=>{
    if(peerState==='offline')return res.sendStatus(503);
    if(peerState==='missing')return res.sendStatus(404);
    if(peerState==='slow'){await new Promise(r=>setTimeout(r,500));}
    res.json({id:req.params.id,name:'Meeting projector',assetTag:'PRJ-TEST',status:peerState});
  });
  peer=await serve(stub);server=await serve(createApp({pool,equipmentUrl:peer.url,timeout:100}));
});
after(async()=>{await server?.close();await peer?.close();await pool?.end();});
test('valid booking is stored with equipment details',async()=>{
  const result=await request(server.url,'/api/bookings','POST',body());assert.equal(result.status,201);
  const found=await request(server.url,`/api/bookings/${result.body.id}`);assert.equal(found.body.equipmentName,'Meeting projector');assert.equal(found.body.requester,'Asha Sen');
});
test('simultaneous requests reserve a slot only once',async()=>{
  const attempts=await Promise.all(Array.from({length:12},()=>request(server.url,'/api/bookings','POST',body(6))));
  assert.equal(attempts.filter(r=>r.status===201).length,1);assert.equal(attempts.filter(r=>r.status===409).length,11);
});
test('concurrent retries with the same key return one reservation',async()=>{
  const headers={'Idempotency-Key':randomUUID()};
  const attempts=await Promise.all(Array.from({length:6},()=>request(server.url,'/api/bookings','POST',body(7),headers)));
  assert.equal(attempts.filter(r=>r.status===201).length,1);assert.equal(new Set(attempts.map(r=>r.body.id)).size,1);
  assert.equal((await request(server.url,'/api/bookings','POST',{...body(7),purpose:'Different purpose'},headers)).status,409);
});
test('cancelling a booking releases only its slot and preserves history',async()=>{
  const first=await request(server.url,'/api/bookings','POST',body(8));
  assert.equal((await request(server.url,`/api/bookings/${first.body.id}/cancel`,'PATCH',{})).body.status,'cancelled');
  assert.equal((await request(server.url,'/api/bookings','POST',body(8))).status,201);
  assert.equal((await request(server.url,`/api/bookings/${first.body.id}`)).body.status,'cancelled');
});
test('maintenance and missing equipment do not create reservations',async()=>{
  peerState='maintenance';assert.equal((await request(server.url,'/api/bookings','POST',body(9))).status,409);
  peerState='missing';assert.equal((await request(server.url,'/api/bookings','POST',body(9))).status,404);
  const result=await pool.query('SELECT count(*) FROM bookings WHERE equipment_id=$1 AND booking_date=$2',[equipmentId,day(9)]);assert.equal(result.rows[0].count,'0');peerState='operational';
});
test('equipment outage and timeout do not block existing booking queries',async()=>{
  peerState='offline';assert.equal((await request(server.url,'/api/bookings','POST',body(10))).status,503);
  assert.equal((await request(server.url,'/api/bookings')).status,200);
  peerState='slow';assert.equal((await request(server.url,'/api/bookings','POST',body(10))).status,503);peerState='operational';
});
test('invalid calendar dates, past dates, empty requester and invalid slots fail',async()=>{
  for(const details of [{date:'0000-01-01'},{date:'2026-02-30'},{date:'2020-01-01'},{requester:' '},{slot:'XX'}]) assert.equal((await request(server.url,'/api/bookings','POST',{...body(11),...details})).status,400);
});
test('availability excludes cancelled reservations',async()=>{
  for(const input of [null,[]]) assert.equal((await request(server.url,'/api/bookings','POST',input)).status,400);
  assert.equal((await request(server.url,'/api/availability?date=0000-01-01')).status,400);
  const result=await request(server.url,`/api/availability?date=${day(8)}`);
  assert.equal(result.status,200);assert.equal(result.body.reserved.filter(r=>r.equipmentId===equipmentId).length,1);
});
