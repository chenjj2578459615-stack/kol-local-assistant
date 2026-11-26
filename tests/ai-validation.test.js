import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAIKey,requestAI} from '../extension/lib/ai.js';
import {classify} from '../extension/lib/core.js';
test('空密钥和混入全角、空白的密钥在发出请求前被拒绝',async()=>{
 assert.equal(validateAIKey(' key-123 '),'key-123');
 assert.equal(validateAIKey('',{required:false}),'');
 for(const key of ['', 'key-ＡＢＣ', 'key 123', 'key\n123', 'key\u200b123']){
  let called=false;
  await assert.rejects(()=>requestAI({endpoint:'https://example.test/v1',model:'m'},key,{bio:'',videos:[]},{fetcher:async()=>{called=true;}}),/API Key/);
  assert.equal(called,false);
 }
});
test('带图片请求的401明确提示鉴权，500明确提示上游；不把它们归因于图片能力',async()=>{
 for(const [status,reason]of [[401,/鉴权失败/],[500,/上游服务/]]){
  await assert.rejects(()=>requestAI({endpoint:'https://example.test/v1',model:'m'},'test-key',{bio:'',videos:[]},{images:[{id:'1',dataUrl:'data:image/png;base64,test'}],fetcher:async()=>({ok:false,status})}),e=>reason.test(e.message)&&!e.message.includes('模型支持图片'));
 }
});
test('繁体简介可以提供明确音乐主题，弱视频关键词不遮蔽明确简介',()=>{
 assert.equal(classify([],'最新專輯『傻瓜探戈』正式發行'),'音乐舞蹈');
 assert.equal(classify([{description:'新作品預告'},{description:'謝謝大家'},{description:'下一首歌'}],'歌手，音乐创作者'),'音乐舞蹈');
});
