import { Preparer, PreparerContext } from '../types';

import {
  RPCOperation,
  RPCActivateOperation,
  RPCDelegateOperation,
  RPCTransferOperation,
  RPCRevealOperation,
  RPCOriginationOperation,
} from '../../operations/types';
import { Context } from '../../context';

class Counter {
  private lastCounter?: number;

  constructor(private pkh: string, private context: Context) {}

  public async next(): Promise<{ value: number }> {
    let counter = this.lastCounter;
    if (typeof counter === 'undefined') {
      const contract = await this.context.rpc.getContract(this.pkh);

      let c = contract ? parseInt(contract.counter || '0', 10) : 0;

      counter = c;
    }

    this.lastCounter = ++counter;
    return { value: this.lastCounter };
  }
}

export class CounterProvider {
  private m: Map<string, Counter> = new Map();

  for(pkh: string, context: Context) {
    if (!this.m.has(pkh)) {
      this.m.set(pkh, new Counter(pkh, context));
    }

    return this.m.get(pkh)!;
  }

  reset(pkh: string) {
    this.m.delete(pkh);
  }

  resetAll() {
    this.m = new Map();
  }
}

type RPCOperationWithCounter =
  | RPCActivateOperation
  | ((
      | RPCOriginationOperation
      | RPCTransferOperation
      | RPCDelegateOperation
      | RPCRevealOperation
    ) & { counter: string });

export class CounterPreparer implements Preparer {
  async prepare(
    unPreparedOps: RPCOperation[],
    context: PreparerContext
  ): Promise<RPCOperationWithCounter[]> {
    const counterProvider = new CounterProvider();
    let results: RPCOperationWithCounter[] = [];
    for (const op of unPreparedOps) {
      if (
        op.kind === 'reveal' ||
        op.kind === 'transaction' ||
        op.kind === 'origination' ||
        op.kind === 'delegation'
      ) {
        const it = counterProvider.for(context.source, context.context);
        results.push(Object.assign(op, { counter: String((await it.next()).value) }));
      } else {
        results.push(op);
      }
    }

    return results;
  }
}