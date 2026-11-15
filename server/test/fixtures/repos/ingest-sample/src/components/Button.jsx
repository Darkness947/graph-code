import { fmt } from '../lib/format';
import '../../../outside';
export default function Button({ label }) {
  return <button>{fmt(label)}</button>;
}
