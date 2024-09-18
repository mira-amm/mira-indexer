/*
 * Please refer to https://docs.envio.dev for a thorough guide on all Envio indexer features
 */
import {Mira, Mira_type2 as PoolId} from "generated";

const poolIdToStr = (poolId: PoolId) => `${poolId[0].bits}_${poolId[1].bits}_${poolId[2]}`;

Mira.CreatePoolEvent.handler(async ({event, context}) => {
    let pool = {
        id: poolIdToStr(event.params.pool_id),
        reserve_0: 0n,
        reserve_1: 0n,
    };
    context.Pool.set(pool);
});

Mira.MintEvent.handler(async ({event, context}) => {
    let id = poolIdToStr(event.params.pool_id);
    let pool = (await context.Pool.get(id))!;
    context.Pool.set({
        id: id,
        reserve_0: pool.reserve_0 + event.params.asset_0_in,
        reserve_1: pool.reserve_1 + event.params.asset_1_in,
    });
});

Mira.BurnEvent.handler(async ({event, context}) => {
    let id = poolIdToStr(event.params.pool_id);
    let pool = (await context.Pool.get(id))!;
    context.Pool.set({
        id: id,
        reserve_0: pool.reserve_0 - event.params.asset_0_out,
        reserve_1: pool.reserve_1 - event.params.asset_1_out,
    });
});

Mira.SwapEvent.handler(async ({event, context}) => {
    let id = poolIdToStr(event.params.pool_id);
    let pool = (await context.Pool.get(id))!;
    context.Pool.set({
        id: id,
        reserve_0: pool.reserve_0 + event.params.asset_0_in - event.params.asset_0_out,
        reserve_1: pool.reserve_1 + event.params.asset_1_in - event.params.asset_1_out,
    });
});
