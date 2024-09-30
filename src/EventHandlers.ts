/*
 * Please refer to https://docs.envio.dev for a thorough guide on all Envio indexer features
 */
import {
    Mira,
    Mira_type2 as PoolId,
    Mira_type8 as Identity,
    handlerContext as Context,
    Transaction
} from "generated";

type IdentityIsContract = [string, boolean];

interface ExtraEvent {
    pool_id: string;
    asset_0_in: string;
    asset_0_out: string;
    asset_1_in: string;
    asset_1_out: string;
}

function extract(transaction: Transaction): ExtraEvent {
    return {
        pool_id: transaction.pool_id,
        asset_0_in: transaction.asset_0_in.toString(),
        asset_0_out:transaction.asset_0_out.toString(),
        asset_1_in: transaction.asset_1_in.toString(),
        asset_1_out: transaction.asset_1_out.toString(),
    }
}

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

async function upsertTransaction(context: Context, transaction: Transaction) {
    let oldTransaction = await context.Transaction.get(transaction.id);
    if (oldTransaction === undefined) {
        context.Transaction.set(transaction);
    } else {
        let extra: ExtraEvent[] = JSON.parse(oldTransaction.extra ?? "[]");
        extra.push(extract(transaction));
        const enrichedTransaction = {
            ...oldTransaction,
            extra: JSON.stringify(extra)
        };
        context.Transaction.set(enrichedTransaction);
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
    let pool = await context.Pool.get(poolId);
    if (pool === undefined) {
        context.log.error(`Pool ${poolId} not found but received MintEvent`);
    }
    context.Pool.set({
        id: poolId,
        asset_0: event.params.pool_id[0].bits,
        asset_1: event.params.pool_id[1].bits,
        is_stable: event.params.pool_id[2],
        reserve_0: (pool?.reserve_0 ?? 0n) + event.params.asset_0_in,
        reserve_1: (pool?.reserve_1 ?? 0n) + event.params.asset_1_in,
    });
    let [address, isContract] = identityToStr(event.params.recipient);
    let transaction: Transaction = {
        id: event.transaction.id,
        transaction_type: "ADD_LIQUIDITY",
        pool_id: poolId,
        initiator: address,
        is_contract_initiator: isContract,
        asset_0_in: event.params.asset_0_in,
        asset_0_out: 0n,
        asset_1_in: event.params.asset_1_in,
        asset_1_out: 0n,
        block_time: event.block.time,
        extra: undefined
    };
    await upsertTransaction(context, transaction);
});

Mira.BurnEvent.handler(async ({event, context}) => {
    let poolId = poolIdToStr(event.params.pool_id);
    let pool = await context.Pool.get(poolId);
    if (pool === undefined) {
        context.log.error(`Pool ${poolId} not found but received BurnEvent`);
    }
    context.Pool.set({
        id: poolId,
        asset_0: event.params.pool_id[0].bits,
        asset_1: event.params.pool_id[1].bits,
        is_stable: event.params.pool_id[2],
        reserve_0: (pool?.reserve_0 ?? 0n) - event.params.asset_0_out,
        reserve_1: (pool?.reserve_1 ?? 0n) - event.params.asset_1_out,
    });
    let [address, isContract] = identityToStr(event.params.recipient);
    let transaction: Transaction = {
        id: event.transaction.id,
        pool_id: poolId,
        transaction_type: "REMOVE_LIQUIDITY",
        initiator: address,
        is_contract_initiator: isContract,
        asset_0_in: 0n,
        asset_0_out: event.params.asset_0_out,
        asset_1_in: 0n,
        asset_1_out: event.params.asset_1_out,
        block_time: event.block.time,
        extra: undefined
    };
    await upsertTransaction(context, transaction);
});

Mira.SwapEvent.handler(async ({event, context}) => {
    let poolId = poolIdToStr(event.params.pool_id);

    let dailyTimestamp = new Date(event.block.time * 1000).setHours(0, 0, 0, 0) / 1000;
    let dailySnapshotId = `${poolId}_${dailyTimestamp}`

    let hourlyTimestamp = new Date(event.block.time * 1000).setMinutes(0, 0, 0) / 1000;
    let hourlySnapshotId = `${poolId}_${hourlyTimestamp}`

    const [pool, dailySnapshot, hourlySnapshot] = await Promise.all([
        context.Pool.get(poolId),
        context.SwapDaily.get(dailySnapshotId),
        context.SwapHourly.get(hourlySnapshotId),
    ]);

    if (pool === undefined) {
        context.log.error(`Pool ${poolId} not found but received SwapEvent`);
    }

    context.Pool.set({
        id: poolId,
        asset_0: event.params.pool_id[0].bits,
        asset_1: event.params.pool_id[1].bits,
        is_stable: event.params.pool_id[2],
        reserve_0: (pool?.reserve_0 ?? 0n) + event.params.asset_0_in - event.params.asset_0_out,
        reserve_1: (pool?.reserve_1 ?? 0n) + event.params.asset_1_in - event.params.asset_1_out,
    });

    let [address, isContract] = identityToStr(event.params.recipient);
    let transaction: Transaction = {
        id: event.transaction.id,
        pool_id: poolId,
        transaction_type: "SWAP",
        initiator: address,
        is_contract_initiator: isContract,
        asset_0_in: event.params.asset_0_in,
        asset_0_out: event.params.asset_0_out,
        asset_1_in: event.params.asset_1_in,
        asset_1_out: event.params.asset_1_out,
        block_time: event.block.time,
        extra: undefined
    };
    await upsertTransaction(context, transaction);

    context.SwapDaily.set({
        id: dailySnapshotId,
        pool_id: poolId,
        snapshot_time: dailyTimestamp,
        count: (dailySnapshot?.count ?? 0) + 1,
        asset_0_in: (dailySnapshot?.asset_0_in ?? 0n) + event.params.asset_0_in,
        asset_0_out: (dailySnapshot?.asset_0_out ?? 0n) + event.params.asset_0_out,
        asset_1_in: (dailySnapshot?.asset_1_in ?? 0n) + event.params.asset_1_in,
        asset_1_out: (dailySnapshot?.asset_1_out ?? 0n) + event.params.asset_1_out,
    });

    context.SwapHourly.set({
        id: hourlySnapshotId,
        pool_id: poolId,
        snapshot_time: hourlyTimestamp,
        count: (hourlySnapshot?.count ?? 0) + 1,
        asset_0_in: (hourlySnapshot?.asset_0_in ?? 0n) + event.params.asset_0_in,
        asset_0_out: (hourlySnapshot?.asset_0_out ?? 0n) + event.params.asset_0_out,
        asset_1_in: (hourlySnapshot?.asset_1_in ?? 0n) + event.params.asset_1_in,
        asset_1_out: (hourlySnapshot?.asset_1_out ?? 0n) + event.params.asset_1_out,
    });
});
