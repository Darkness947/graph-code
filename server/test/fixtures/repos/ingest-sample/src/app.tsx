import { util } from '@/lib/util';
import Button from './components/Button';
import { Card } from './components';
import React from 'react';
import { x } from './missing';
import y from '@/nope/thing';
const load = (name: string) => import(name);
export default function App() {
  return <Button label={util + x + y} card={Card} load={load} react={React} />;
}
