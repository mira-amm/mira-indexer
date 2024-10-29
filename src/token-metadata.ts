import {
  SRC20,
} from "generated";
import {v4 as uuid} from 'uuid';
import BN from 'bn.js';

SRC20.SetNameEvent.handler(async ({ event, context }) => {
  let asset = await context.Asset.get(event.params.asset.bits);
  if (!asset) {
    asset = {
      id: event.params.asset.bits,
      contract: undefined,
      sub_id: undefined,
      name: undefined,
      symbol: undefined,
      decimals: undefined,
    };
  }

  context.Asset.set({
    ...asset,
    name: event.params.name.payload!.bytes.toString(),
  })
}, { wildcard: true})
