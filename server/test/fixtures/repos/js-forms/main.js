import def from './a';
import { named } from './b.js';
import * as ns from './c.jsx';
import './side-effect';
export * from './d.mjs';
export { thing } from './e.cjs';
export * as space from './f';
const g = require('./g');
const lazy = () => import('./h');
const dyn = (name) => import(name);
const dyn2 = require(process.env.X);
import react from 'react';
export const one = 1, two = 2;
export function fn() {}
export class Cls {}
export default function () {}
export { def as renamed };
