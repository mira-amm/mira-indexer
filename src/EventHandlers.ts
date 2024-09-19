/*
 * Please refer to https://docs.envio.dev for a thorough guide on all Envio indexer features
 */
import {
    Mira,
    Mira_type2 as PoolId,
    Mira_type8 as Identity,
} from "generated";
import {v4 as randomUuid} from 'uuid';

type IdentityIsContract = [string, boolean];

function poolIdToStr(poolId: PoolId): string {
    return `${poolId[0].bits}_${poolId[1].bits}_${poolId[2]}`
}

function identityToStr(identity: Identity): IdentityIsContract {
    switch (identity.case) {
        case 'Address':
            return [identity.payload.bits, false];
        case 'ContractId':
            return [identity.payload.bits, true];
    }
}

Mira.CreatePoolEvent.handler(async ({event, context}) => {
    let pool = {
        id: poolIdToStr(event.params.pool_id),
        asset_0: event.params.pool_id[0].bits,
        asset_1: event.params.pool_id[1].bits,
        is_stable: event.params.pool_id[2],
        reserve_0: 0n,
        reserve_1: 0n,
    };
    context.Pool.set(pool);
});

Mira.MintEvent.handler(async ({event, context}) => {
    let poolId = poolIdToStr(event.params.pool_id);
    let pool = (await context.Pool.get(poolId))!;
    context.Pool.set({
        id: poolId,
        asset_0: pool.asset_0,
        asset_1: pool.asset_1,
        is_stable: pool.is_stable,
        reserve_0: pool.reserve_0 + event.params.asset_0_in,
        reserve_1: pool.reserve_1 + event.params.asset_1_in,
    });
    let [address, isContract] = identityToStr(event.params.recipient);
    context.AddLiquidity.set({
            id: randomUuid(),
            pool_id: poolId,
            initiator: address,
            is_contract_initiator: isContract,
            asset_0_in: event.params.asset_0_in,
            asset_1_in: event.params.asset_1_in,
            block_time: event.block.time,
        }
    )
});

Mira.BurnEvent.handler(async ({event, context}) => {
    let poolId = poolIdToStr(event.params.pool_id);
    let pool = (await context.Pool.get(poolId))!;
    context.Pool.set({
        id: poolId,
        asset_0: pool.asset_0,
        asset_1: pool.asset_1,
        is_stable: pool.is_stable,
        reserve_0: pool.reserve_0 - event.params.asset_0_out,
        reserve_1: pool.reserve_1 - event.params.asset_1_out,
    });
    let [address, isContract] = identityToStr(event.params.recipient);
    context.RemoveLiquidity.set({
            id: randomUuid(),
            pool_id: poolId,
            initiator: address,
            is_contract_initiator: isContract,
            asset_0_out: event.params.asset_0_out,
            asset_1_out: event.params.asset_1_out,
            block_time: event.block.time,
        }
    )
});

Mira.SwapEvent.handler(async ({event, context}) => {
    let poolId = poolIdToStr(event.params.pool_id);
    let pool = (await context.Pool.get(poolId))!;
    context.Pool.set({
        id: poolId,
        asset_0: pool.asset_0,
        asset_1: pool.asset_1,
        is_stable: pool.is_stable,
        reserve_0: pool.reserve_0 + event.params.asset_0_in - event.params.asset_0_out,
        reserve_1: pool.reserve_1 + event.params.asset_1_in - event.params.asset_1_out,
    });
    let [address, isContract] = identityToStr(event.params.recipient);
    context.Swap.set({
            id: randomUuid(),
            pool_id: poolId,
            initiator: address,
            is_contract_initiator: isContract,
            asset_0: event.params.asset_0_in - event.params.asset_0_out,
            asset_1: event.params.asset_1_in - event.params.asset_1_out,
            block_time: event.block.time,
        }
    )
});
