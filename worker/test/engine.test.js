import test from "node:test";
import assert from "node:assert/strict";
import {step,metrics,CAPITAL} from "../engine.js";
import {simulate} from "../backtest.js";
const M="BTC/USDT",VOL={[M]:1e9};
test("buys toward the target exposure and pays fees and slippage",()=>{
 const st={cash:CAPITAL,pos:{}},r=step(st,{[M]:100},{[M]:1},VOL);
 assert.equal(r.fills.length,1);assert.equal(r.fills[0].side,"buy");
 assert.ok(Math.abs(st.pos[M].qty*100-CAPITAL)<CAPITAL*0.01);
 assert.ok(r.equity<CAPITAL&&r.equity>CAPITAL*0.99)});
test("ignores changes smaller than 1% of equity",()=>{
 const st={cash:CAPITAL,pos:{}};assert.equal(step(st,{[M]:100},{[M]:0.005},VOL).fills.length,0)});
test("paper account can hold short positions",()=>{
 const st={cash:CAPITAL,pos:{}};step(st,{[M]:100},{[M]:-1},VOL);assert.ok(st.pos[M].qty<0)});
test("closing a winning long records positive realized profit",()=>{
 const st={cash:CAPITAL,pos:{}};step(st,{[M]:100},{[M]:1},VOL);
 const r=step(st,{[M]:110},{[M]:0},VOL);
 assert.equal(r.fills[0].side,"sell");assert.ok(r.fills[0].realized_pnl>0)});
test("larger orders on thin markets slip more",()=>{
 const a={cash:CAPITAL,pos:{}},b={cash:CAPITAL,pos:{}};
 const thin=step(a,{[M]:100},{[M]:1},{[M]:2e5}).fills[0].price,deep=step(b,{[M]:100},{[M]:1},{[M]:1e9}).fills[0].price;
 assert.ok(thin>deep)});
test("metrics report return and max drawdown",()=>{
 const m=metrics([100,120,90,110].map(equity=>({equity})),[]);
 assert.ok(Math.abs(m.dd-25)<1e-9);assert.ok(Math.abs(m.ret-10)<1e-9)});
test("win rate counts only closing fills",()=>{
 const m=metrics([100,101].map(equity=>({equity})),[{realized_pnl:null},{realized_pnl:5},{realized_pnl:-1}]);
 assert.equal(m.win,50);assert.equal(m.trades,3)});
test("backtest on a rising market is profitable and caps the chart points",()=>{
 const n=500,closes={[M]:Array.from({length:n},(_,i)=>100+i*0.1)},series=Array.from({length:n},()=>({[M]:1}));
 const r=simulate(series,closes,[M],VOL);
 assert.ok(r.ret>0);assert.ok(r.equity.length<=200);assert.ok(r.trades>=1)});
test("backtest flags a strategy that only worked in the first half",()=>{
 const n=400,closes={[M]:Array.from({length:n},(_,i)=>i<200?100+i*0.5:200-(i-200)*0.5)},series=Array.from({length:n},()=>({[M]:1}));
 const r=simulate(series,closes,[M],VOL);
 assert.ok(r.halves.first.ret>0);assert.ok(r.halves.second.ret<0);assert.equal(r.consistent,false)});
test("backtest on a steady rise is consistent",()=>{
 const n=400,closes={[M]:Array.from({length:n},(_,i)=>100+i*0.3)},series=Array.from({length:n},()=>({[M]:1}));
 assert.equal(simulate(series,closes,[M],VOL).consistent,true)});
