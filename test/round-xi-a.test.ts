import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addPriority, removePriority, priorityGroups } from '../src/core/groups.ts';
import { criteriaFor, evaluate } from '../src/core/engine.ts';
import { CRITERIA, niceDays } from '../src/core/criteria.ts';
import { BINS, BIN_COUNT } from '../src/core/weather-days.ts';
import { stretchScale, stretched, MAP_COLOURS } from '../src/ui/map-scale.ts';
import { climateOf, niceStrip, niceMonthCounts } from '../src/ui/climate.ts';
import { loadProfile, saveProfile, type AppState } from '../src/ui/state.ts';
import { fixture, profile } from './fixture.ts';
const zero = Object.fromEntries(CRITERIA.map(c=>[c.id,0]));
const state = (p: ReturnType<typeof profile>, data = fixture()): AppState => ({data,profile:p,view:'cities',city:null,measure:'air',valuesOpen:true,openGroups:[],live:null,fetchedHere:[],taxOpen:[],moreOpen:false,shareInclude:[]});

test('catalogue removal stops scoring, preserves stances and ratings, and re-add restores exact weights', () => {
  const p = profile({weights:{...zero,politics:17,'mine-family':23},stances:{politics:3},personal:[{id:'mine-family',label:'Family',scores:{'turin-it':5}}]});
  const before = structuredClone(p);
  const score = evaluate(fixture(),p).results[0]!.total;
  for(const id of ['stand','own']) removePriority(p,id,criteriaFor(p));
  assert.equal(evaluate(fixture(),p).results[0]!.total,0);
  assert.deepEqual(p.stances,before.stances); assert.deepEqual(p.personal,before.personal);
  assert.deepEqual(priorityGroups(p,criteriaFor(p)).active,[]);
  for(const id of ['stand','own']) addPriority(p,id,criteriaFor(p));
  assert.deepEqual(p.weights,before.weights);
  assert.equal(evaluate(fixture(),p).results[0]!.total,score);
});

test('active priorities order by score share, not a fixed Money position; Required takes no share', () => {
  const p=profile({weights:{...zero,money_left:5,nice_days:30,happiness:10,right_to_live:100},dealBreakers:['right_to_live']});
  assert.deepEqual(priorityGroups(p,criteriaFor(p)).active.map(g=>g.group.id),['climate','people','money']);
});

test('saved zero groups migrate inactive; parked weights survive a browser save/load', () => {
  const storage=new Map<string,string>();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v)}});
  Object.defineProperty(globalThis,'location',{configurable:true,value:{hash:'',search:''}});
  try {
    const p=profile({weights:{...zero,nice_days:31}});
    saveProfile(p); const migrated=loadProfile(fixture());
    assert.deepEqual(priorityGroups(migrated,criteriaFor(migrated)).active.map(g=>g.group.id),['climate']);
    removePriority(migrated,'climate',criteriaFor(migrated)); saveProfile(migrated);
    const loaded=loadProfile(fixture()); addPriority(loaded,'climate',criteriaFor(loaded));
    assert.equal(loaded.weights.nice_days,31);
  } finally {Reflect.deleteProperty(globalThis,'localStorage');Reflect.deleteProperty(globalThis,'location');}
});

test('monthly nice-day strip sums to the engine annual count and exposes all twelve text values', () => {
  const d=fixture(), bins=Array(12*BIN_COUNT).fill(0) as number[];
  for(let month=0;month<12;month++) bins[month*BIN_COUNT+22-BINS.from]=month+1;
  d.observations['turin-it']!.push({metric:'nice_bins_feels',value:bins,source:'test',period:'2021-2025',level:'city',retrieved:'2026-11-19'});
  const p=profile({cities:['turin-it'],weights:{...zero,nice_days:10}}),city=d.cities.find(c=>c.id==='turin-it')!;
  const months=niceDays(d,p,city)!.months;
  assert.equal(months.reduce((a,b)=>a+b,0),evaluate(d,p).results[0]!.lines.find(l=>l.id==='nice_days')!.raw.value);
  const strip=niceStrip(climateOf(state(p,d),city)!,city.name).value;
  const fractional = Array(12).fill(2.4) as number[];
  assert.equal(niceMonthCounts(fractional).reduce((a,b)=>a+b,0), Math.round(fractional.reduce((a,b)=>a+b,0)));
  assert.equal((strip.match(/class="nm"/g)??[]).length,12);
  assert.match(strip,/January: 1/); assert.match(strip,/December: 12/); assert.match(strip,/78 nice days a year/);
});

test('map stretch uses visible 5th–95th percentile, saturates outliers, handles equal and absent data', () => {
  assert.deepEqual(stretchScale([0,40,50,60,100]),[8,92]);
  assert.equal(stretched(40, [40,60]),0); assert.equal(stretched(60,[40,60]),1);
  assert.equal(stretched(50,[40,60]),.5); assert.equal(stretched(1000,[40,60]),1);
  assert.equal(stretched(7,[7,7]),.5); assert.equal(stretchScale([NaN]),null);
});

test('map end colours retain a strong luminance ramp under Machado full deuteranopia simulation', () => {
  // Machado, Oliveira, Fernandes (2009), severity 1.0, linear RGB matrix.
  const matrix=[[.367322,.860646,-.227968],[.280085,.672501,.047413],[-.011820,.042940,.968881]];
  const linear=(c:number)=> c/255<=.04045 ? c/255/12.92 : ((c/255+.055)/1.055)**2.4;
  const luminance=MAP_COLOURS.map(col=>{
    const rgb=col.map(linear), simulated=matrix.map(row=>Math.max(0,Math.min(1,row.reduce((s,v,i)=>s+v*rgb[i]!,0))));
    return simulated[0]!*.2126+simulated[1]!*.7152+simulated[2]!*.0722;
  });
  assert.ok(luminance[1]!>luminance[0]!+.15); assert.ok(luminance[2]!>luminance[1]!+.15);
  assert.ok((luminance[2]!+.05)/(luminance[0]!+.05)>3);
});
