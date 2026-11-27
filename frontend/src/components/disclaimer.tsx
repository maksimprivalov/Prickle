import { NOT_FINANCIAL_ADVICE } from '@prickle/backend/contracts';

export function Disclaimer() {
  return <p className="font-semibold">{NOT_FINANCIAL_ADVICE}</p>;
}
