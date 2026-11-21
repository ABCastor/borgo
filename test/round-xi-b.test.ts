import assert from 'node:assert/strict';
import { test } from 'node:test';
import { criteriaFor, evaluate } from '../src/core/engine.ts';
import { grouped } from '../src/core/groups.ts';
import { fixture, profile } from './fixture.ts';
import { emptyProfile, introFor, hideIntro, saveProfile, type AppState } from '../src/ui/state.ts';
import { topQuestion } from '../src/ui/top.ts';
import { groupMissing, valuesSheet } from '../src/ui/values.ts';
import { aiSetup, AI_PROMPT } from '../src/ui/onboarding.ts';
const data = fixture();
const app = (p = emptyProfile(data)): AppState => ({data,profile:p,view:'cities',city:null,measure:'air',valuesOpen:true,openGroups:['money','climate'],live:null,fetchedHere:[],taxOpen:[],moreOpen:false,shareInclude:[],intro:true});

test('first visit shows setup; any saved profile including an empty comparison is returning', () => {
  const storage = new Map<string,string>();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v)}});
  const p = emptyProfile(data);
  assert.equal(introFor(p,false),true);
  assert.equal(introFor(p,true),false);
  assert.match(topQuestion(app(p),evaluate(data,p)).value,/Which cities are you weighing\?/);
  saveProfile(p);
  assert.equal(introFor(p,false),false);
  storage.clear();
  hideIntro();
  assert.equal(introFor(p,false),false);
  storage.clear();
});

test('each conversational step owns its real answers, next step and skip, without duplicate input IDs', () => {
  const s = app(profile());
  const expected = [/id="add-city"/, /Add priority/, /id="setup-salary"/, /id="p0-pass"/, /class="nice-live"/];
  for(let step=0;step<5;step++) {
    s.onboardingStep=step;
    const ui=topQuestion(s,evaluate(data,s.profile)).value;
    assert.match(ui,expected[step]!);
    assert.match(ui,/Skip setup/);
    assert.match(ui,step===4?/See my cities/:/Next:/);
    const ids=[...ui.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]);
    assert.equal(new Set(ids).size,ids.length,`unique IDs at step ${step}`);
  }
  s.intro=false;
  const collapsed=topQuestion(s,evaluate(data,s.profile)).value;
  assert.doesNotMatch(collapsed,/class="intro"|class="ai-setup"/);
});

test('missing money is one unlocking sentence per group, not per city, dial or Required line', () => {
  const s=app(emptyProfile(data));
  s.profile.cities=data.cities.map(c=>c.id);
  s.profile.dealBreakers=['money_left'];
  const ui=valuesSheet(s).value;
  assert.doesNotMatch(ui,/No figure for .*so it does not count there/);
  assert.ok((ui.match(/class="hint group-missing"/g)??[]).length <= 2);
  s.profile.dealBreakers=[];
  assert.equal((valuesSheet(s).value.match(/Money counts once you add your salary\./g)??[]).length,1);
});

test('a partly missing group names unavailable cities and where it still counts once', () => {
  const s=app(profile({cities:['turin-it','dublin-ie'],weights:{happiness:10}}));
  const group=grouped(criteriaFor(s.profile)).find(g=>g.group.id==='people')!;
  const line=groupMissing(s,group.group,group.parts.filter(c=>c.id==='happiness'),{happiness:['Dublin']}).value;
  assert.match(line,/No figure for Dublin: People and society counts only for Torino\./);
  assert.equal((line.match(/<p/g)??[]).length,1);
});

test('AI card orders the visible prompt, paired assistants, copy actions and labelled connection rows', () => {
  const ui=aiSetup().value;
  assert.ok(ui.indexOf('id="ai-prompt"') < ui.indexOf('Open in ChatGPT'));
  assert.ok(ui.indexOf('Open in ChatGPT') < ui.indexOf('Open in Claude'));
  assert.ok(ui.indexOf('Open in Claude') < ui.indexOf('Copy prompt'));
  assert.equal((ui.match(/class="pill-btn"/g)??[]).length,4);
  assert.match(ui,/Remote MCP/); assert.match(ui,/Local install/);
  assert.ok(AI_PROMPT.includes('MCP does not change my browser comparison'));
});

test("every source has a readable short name, never its internal id", async () => {
  const { SOURCE_SHORT } = await import("../src/ui/results.ts");
  const { readFileSync } = await import("node:fs");
  const d = JSON.parse(readFileSync(new URL("../public/data/dataset.json", import.meta.url), "utf8"));
  const missing = Object.keys(d.sources).filter((id) => !SOURCE_SHORT[id]);
  assert.deepEqual(missing, []);
});
