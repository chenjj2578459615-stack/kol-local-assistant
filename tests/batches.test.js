import test from 'node:test';import assert from 'node:assert/strict';
import {batchKey,batchPersistence} from '../extension/lib/batches.js';
test('每批单独保存完整结果，历史索引只放摘要，后续同达人不覆盖旧快照',()=>{
 const state={batch:{id:'one',createdAt:100},history:[],rows:[{handle:'tester',status:'complete',videos:[{id:'123',views:55}],result:{average:55}}],config:{statsDays:30,brands:''},columns:[{key:'average',visible:true}],draft:{entries:[{url:'https://www.tiktok.com/@tester'}]},run:{status:'finished',now:100}};
 const old=batchPersistence(state,200);assert.equal(old[batchKey('one')].rows[0].result.average,55);assert.equal(state.history[0].count,1);assert.equal(state.history[0].rows,undefined);
 state.rows[0].result.average=77;state.rows[0].videos[0].views=77;assert.equal(old[batchKey('one')].rows[0].result.average,55);
 state.batch={id:'two',createdAt:300};state.config.statsDays=7;const next=batchPersistence(state,400);
 assert.equal(next[batchKey('one')],undefined);assert.equal(next[batchKey('two')].rows[0].result.average,77);assert.equal(state.history.length,2);
 assert.equal(old[batchKey('one')].config.statsDays,30);assert.equal(state.history[1].statsDays,30);
});
