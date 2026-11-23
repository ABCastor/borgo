import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fixture, profile } from './fixture.ts';
import { countryLineScores, tileLand, weightedLand } from '../src/core/land-score.ts';
import { candidateScorer, evaluate, scoreCandidates } from '../src/core/engine.ts';
import { themeChoice, nextTheme, applyTheme, cycleTheme, THEME_KEY } from '../src/ui/theme.ts';
import { transitionView } from '../src/ui/transitions.ts';
import { resolvePlace, PLACE_ALIASES } from '../src/places/resolve.ts';
import { fakeCtx } from './fake-network.ts';
import type { Country } from '../src/core/types.ts';

const countries = JSON.parse(readFileSync(new URL('../data/countries.json', import.meta.url), 'utf8')) as Record<string, Country>;

test('land renormalises available priorities, excludes missing and Required lines, and changes with weights', () => {
  const p = profile({ weights: { safety: 20, long_life: 10 }, dealBreakers: [] });
  const scores = new Map([['safety', .2], ['long_life', .9]]);
  const a = weightedLand(scores, p);
  p.weights.safety = 80;
  const b = weightedLand(scores, p);
  assert.notEqual(a.score, b.score);
  assert.ok(a.coverage > 0 && a.coverage <= 1);
  p.dealBreakers = ['safety'];
  assert.equal(weightedLand(scores, p).score, .9);
  assert.equal(weightedLand(undefined, p).score, null);
});

test('land only uses country observations and shares city line scoring; city map candidates equal engine scores', () => {
  const data = fixture();
  const p = profile();
  const city = data.cities[0]!;
  data.observations[city.id] = [{ metric: 'homicide_rate', value: 3, level: 'country', source: 'test', period: '2024', retrieved: '2024-01-01' }];
  const scores = countryLineScores(data, p);
  p.cities = [city.id];
  const result = evaluate(data, p).results[0]!;
  assert.equal(scores.get(city.country)?.get('safety'), result.lines.find(l => l.id === 'safety')!.score);
  assert.equal(scores.get(city.country)?.has('nice_days'), false);
  assert.equal(scoreCandidates(data,p,[city.id]).get(city.id)!.total, result.total);
});

test('cached map candidates match fresh engine scores across weights, raw inputs, requirements and datasets', () => {
  const data=fixture(), p=profile(), cached=candidateScorer();
  const ids=data.cities.map(c=>c.id);
  const check=(d=data)=>assert.deepEqual(cached(d,p,ids),scoreCandidates(d,p,ids));
  check();
  p.weights.safety=100; p.weights.nice_days=1; check();
  p.income.gross=90000; check();
  p.prefs.comfort.min=24; check();
  p.dealBreakers=['right_to_live']; check();
  p.prefs.normalise='relative'; p.weights.long_life=50; check();
  p.overrides[ids[0]!] = { homicide_rate: 0.1 }; check();
  check(structuredClone(data));
});

test('reduced motion and unsupported browsers bypass View Transitions; supported ones use it', () => {
  let updates = 0, transitions = 0;
  const update = () => { updates++; };
  const host = { startViewTransition: ((fn: () => void) => { transitions++; fn(); }) as unknown as Document['startViewTransition'] };
  transitionView(update, host, true);
  assert.equal(transitions, 0);
  transitionView(update, {} as Pick<Document,'startViewTransition'>, false);
  assert.equal(updates, 2);
  transitionView(update, host, false);
  assert.equal(transitions, 1);
  assert.equal(updates, 3);
});

test('theme cycles system, light, dark; persists choice and restores color-scheme before paint', () => {
  const attrs = new Map<string,string>(), saved = new Map<string,string>();
  const root = { dataset: {themeChoice:'system'}, style: {colorScheme:''} };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: root, querySelectorAll: () => [{setAttribute:(k:string,v:string)=>attrs.set(k,v)}] } });
  Object.defineProperty(globalThis, 'localStorage', { configurable:true, value:{setItem:(k:string,v:string)=>saved.set(k,v)} });
  for (const expected of ['light','dark','system']) { cycleTheme(); assert.equal(saved.get(THEME_KEY), expected); }
  applyTheme(themeChoice('dark'));
  assert.equal(root.style.colorScheme,'dark');
  assert.match(attrs.get('aria-label')!, /Switch to system/);
  assert.equal(nextTheme('system'),'light');
  assert.equal(themeChoice('invalid'),'system');
  const html = readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  assert.ok(html.indexOf("localStorage.getItem('borgo:theme')") < html.indexOf('rel="stylesheet"'));
  delete (globalThis as {document?:unknown}).document;
  delete (globalThis as {localStorage?:unknown}).localStorage;
});

const recorded: Record<string, object> = {
  hawaii: {id:5856195,name:'Honolulu',country_code:'US',latitude:21.30694,longitude:-157.85834,population:350964},
  'la palma': {id:2511180,name:'Santa Cruz de La Palma',country_code:'ES',latitude:28.68351,longitude:-17.76421,population:15674},
  menorca: {id:2514301,name:'Maó',country_code:'ES',latitude:39.88853,longitude:4.26583,population:29125},
  bombay: {id:1275339,name:'Mumbai',country_code:'IN',latitude:19.07283,longitude:72.88261,population:12691836},
};
for (const query of ['Hawaii','La Palma','Menorca','Bombay']) test(`${query} ranks its labelled intended place before namesakes`, async () => {
  const key=query.toLowerCase(), alias=PLACE_ALIASES[key]!;
  const ctx = fakeCtx([
    [/\/get\?id=/, u => new URL(u).searchParams.get('id') === String(alias.id) ? recorded[key]! : {}],
    [/\/search\?/, () => ({results:[{id:12345,name:query,country_code:'US',latitude:40,longitude:-70,population:1000000,feature_code:'PPL'}]})],
  ]);
  const result=await resolvePlace(query,ctx.ctx,{countries,known:[],regions:false});
  assert.equal(result[0]!.city.geonames,String(alias.id));
  assert.equal(result[0]!.stands,alias.stands);
  assert.ok(result[0]!.label.includes(alias.stands));
  assert.deepEqual(result[0]!.city.aliases,[query]);
});

test('a country qualifier preserves a Bombay namesake instead of redirecting to Mumbai', async () => {
  const ctx=fakeCtx([[/\/search\?/,()=>({results:[{id:5109718,name:'Bombay',country_code:'US',latitude:44.93893,longitude:-74.56769,population:100001}]})]]);
  const result=await resolvePlace('Bombay, US',ctx.ctx,{countries,known:[],regions:false});
  assert.equal(result[0]!.city.geonames,'5109718');
  assert.equal(result[0]!.stands,undefined);
});

test('with only Money and Weather weighted, land still follows the sliders: nice days read as months in range', () => {
  const p = profile({ weights: { money_left: 50, nice_days: 50 }, dealBreakers: [] });
  const country = weightedLand(new Map(), p);
  const warm = tileLand(country, 10 / 12), cold = tileLand(country, 2 / 12);
  assert.ok(warm.score !== null && cold.score !== null && warm.score > cold.score, 'a tile with more months in range scores higher');
  assert.ok(warm.coverage > 0 && warm.coverage < 1, 'money stays city-only, so coverage is partial');
  const withSafety = weightedLand(new Map([['safety', .1]]), profile({ weights: { nice_days: 50, safety: 50 }, dealBreakers: [] }));
  const lowSafety = tileLand(withSafety, 10 / 12).score!;
  const heavyWeather = tileLand(weightedLand(new Map([['safety', .1]]), profile({ weights: { nice_days: 90, safety: 10 }, dealBreakers: [] })), 10 / 12).score!;
  assert.ok(heavyWeather > lowSafety, 'moving weight to weather moves a warm, unsafe tile up');
});
