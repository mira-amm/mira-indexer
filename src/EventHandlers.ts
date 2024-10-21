/*
 * Please refer to https://docs.envio.dev for a thorough guide on all Envio indexer features
 */
import {
    Mira,
    Mira_type2 as PoolId,
    Mira_type8 as Identity,
    handlerContext as Context,
    Transaction,
    Pool,
} from "generated";
import {v4 as uuid} from 'uuid';

type IdentityIsContract = [string, boolean];

const ONE_E_18 = BigInt(10) ^ BigInt(18);
const BASIS_POINTS = BigInt(10000);
const AMM_FEES: AmmFees = {
    lpFeeVolatile: BigInt(30),
    lpFeeStable: BigInt(5),
    protocolFeeStable: BigInt(0),
    protocolFeeVolatile: BigInt(0),
}

function roundingUpDivision(nominator: bigint, denominator: bigint): bigint {
    let roundingDownDivisionResult = nominator / denominator;
    if (nominator % denominator === BigInt(0)) {
        return roundingDownDivisionResult;
    } else {
        return roundingDownDivisionResult + BigInt(1);
    }
}

interface ExtraEvent {
    pool_id: string;
    transaction_type: string;
    lp_id: string | undefined;
    lp_amount: string | undefined;
    asset_0_in: string;
    asset_0_out: string;
    asset_1_in: string;
    asset_1_out: string;
}

function extract(transaction: Transaction): ExtraEvent {
    return {
        lp_amount: transaction.lp_amount?.toString(),
        lp_id: transaction.lp_id,
        pool_id: transaction.pool_id,
        transaction_type: transaction.transaction_type,
        asset_0_in: transaction.asset_0_in.toString(),
        asset_0_out: transaction.asset_0_out.toString(),
        asset_1_in: transaction.asset_1_in.toString(),
        asset_1_out: transaction.asset_1_out.toString()
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

function powDecimals(decimals: number): bigint {
    return BigInt(10) ^ BigInt(decimals);
}

interface AmmFees {
    lpFeeVolatile: bigint,
    lpFeeStable: bigint,
    protocolFeeVolatile: bigint,
    protocolFeeStable: bigint,
}

function k(
    isStable: boolean,
    x: bigint,
    y: bigint,
    powDecimalsX: bigint,
    powDecimalsY: bigint
): bigint {
    if (isStable) {
        const _x: bigint = x * ONE_E_18 / powDecimalsX;
        const _y: bigint = y * ONE_E_18 / powDecimalsY;
        const _a: bigint = _x * _y / ONE_E_18;
        const _b: bigint = (_x * _x / ONE_E_18) + (_y * _y / ONE_E_18);
        return _a * _b / ONE_E_18; // x3y+y3x >= k
    } else {
        return x * y; // xy >= k
    }
}

function kPool(pool: Pool): bigint {
    return k(
        pool.is_stable,
        pool.reserve_0,
        pool.reserve_1,
        powDecimals(pool.decimals_0),
        powDecimals(pool.decimals_1),
    );
}

function calculateFee(
    poolId: PoolId,
    amount: bigint,
    ammFees: AmmFees
): bigint {
    const feeBP = poolId[2] ?
        ammFees.lpFeeStable + ammFees.protocolFeeStable :
        ammFees.lpFeeVolatile + ammFees.protocolFeeVolatile;
    const nominator = amount * feeBP;
    return roundingUpDivision(nominator, BASIS_POINTS);
}

async function upsertTransaction(context: Context, transaction: Transaction) {
    const oldTransaction = await context.Transaction.get(transaction.id);
    if (oldTransaction === undefined) {
        context.Transaction.set(transaction);
    } else {
        const extra: ExtraEvent[] = JSON.parse(oldTransaction.extra ?? "[]");
        extra.push(extract(transaction));
        const enrichedTransaction = {
            ...oldTransaction,
            initiator: transaction.initiator,
            extra: JSON.stringify(extra)
        };
        context.Transaction.set(enrichedTransaction);
    }
}

const shouldReturnEarlyDueToDuplicate = async (duplicateId: string, context: Context) => {
    const deduplicator = await context.DeDuplicator.get(duplicateId);
    if (deduplicator === undefined) {
        context.DeDuplicator.set({id: duplicateId, additionalDuplications: 0});
        return false;
    } else {
        // Return Early
        context.DeDuplicator.set({...deduplicator, additionalDuplications: deduplicator.additionalDuplications + 1});
        return true;
    }
}

Mira.CreatePoolEvent.handler(async ({event, context}) => {
    // Save a raw event
    const id = `${event.logIndex}_${event.transaction.id}_${event.block.height}`
    const rawEvent = {
        id: id,
        pool_id: poolIdToStr(event.params.pool_id),
        decimals_0: event.params.decimals_0,
        decimals_1: event.params.decimals_1,
        logIndex: event.logIndex,
        transactionId: event.transaction.id,
        blockId: event.block.id,
        blockHeight: event.block.height
    };
    context.RawCreatePoolEvent.set(rawEvent);

    context.log.info(`Handling CreatePoolEvent for pool ID: ${poolIdToStr(event.params.pool_id)}`);

    if (await shouldReturnEarlyDueToDuplicate(id, context)) {
        context.log.error(`Return Early due to duplicate in CreatePoolEvent - tx: ${event.transaction.id}`);
        return;
    }

    const pool = {
        id: poolIdToStr(event.params.pool_id),
        asset_0: event.params.pool_id[0].bits,
        asset_1: event.params.pool_id[1].bits,
        is_stable: event.params.pool_id[2],
        reserve_0: 0n,
        reserve_1: 0n,
        create_time: event.block.time,
        decimals_0: event.params.decimals_0,
        decimals_1: event.params.decimals_1
    };
    context.Pool.set(pool);
});


Mira.MintEvent.handler(async ({event, context}) => {
    // Save a raw event
    const id = `${event.logIndex}_${event.transaction.id}_${event.block.height}`
    const rawEvent = {
        id: id,
        pool_id: poolIdToStr(event.params.pool_id),
        recipient: identityToStr(event.params.recipient)[0],
        liquidity: event.params.liquidity.id.bits,
        asset_0_in: event.params.asset_0_in,
        asset_1_in: event.params.asset_1_in,
        logIndex: event.logIndex,
        transactionId: event.transaction.id,
        blockId: event.block.id,
        blockHeight: event.block.height
    };
    context.RawMintEvent.set(rawEvent);

    context.log.info(`Handling MintEvent for transaction ID: ${event.transaction.id}`);

    if (await shouldReturnEarlyDueToDuplicate(id, context)) {
        context.log.error(`Return Early due to duplicate in MintEvent - tx: ${event.transaction.id}`);
        return;
    }

    const poolId = poolIdToStr(event.params.pool_id);
    const pool = await context.Pool.get(poolId);
    if (pool === undefined) {
        context.log.error(`Pool ${poolId} not found but received MintEvent`);
        return;
    }
    context.Pool.set({
        id: poolId,
        asset_0: event.params.pool_id[0].bits,
        asset_1: event.params.pool_id[1].bits,
        is_stable: event.params.pool_id[2],
        reserve_0: (pool?.reserve_0 ?? 0n) + event.params.asset_0_in,
        reserve_1: (pool?.reserve_1 ?? 0n) + event.params.asset_1_in,
        create_time: pool?.create_time ?? event.block.time,
        decimals_0: pool?.decimals_0,
        decimals_1: pool?.decimals_1,
    });
    const [address, isContract] = identityToStr(event.params.recipient);
    const transaction: Transaction = {
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
        lp_id: event.params.liquidity.id.bits,
        lp_amount: event.params.liquidity.amount,
        extra: undefined
    };
    await upsertTransaction(context, transaction);
});

Mira.BurnEvent.handler(async ({event, context}) => {
    // Save a raw event
    const id = `${event.logIndex}_${event.transaction.id}_${event.block.height}`
    const rawEvent = {
        id: id,
        pool_id: poolIdToStr(event.params.pool_id),
        recipient: identityToStr(event.params.recipient)[0],
        liquidity: event.params.liquidity.id.bits,
        asset_0_out: event.params.asset_0_out,
        asset_1_out: event.params.asset_1_out,
        logIndex: event.logIndex,
        transactionId: event.transaction.id,
        blockId: event.block.id,
        blockHeight: event.block.height
    };
    context.RawBurnEvent.set(rawEvent);

    context.log.info(`Handling BurnEvent for transaction ID: ${event.transaction.id}`);

    if (await shouldReturnEarlyDueToDuplicate(id, context)) {
        context.log.error(`Return Early due to duplicate in BurnEvent - tx: ${event.transaction.id}`);
        return;
    }

    const poolId = poolIdToStr(event.params.pool_id);
    const pool = await context.Pool.get(poolId);
    if (pool === undefined) {
        context.log.error(`Pool ${poolId} not found but received BurnEvent`);
        return;
    }
    context.Pool.set({
        id: poolId,
        asset_0: event.params.pool_id[0].bits,
        asset_1: event.params.pool_id[1].bits,
        is_stable: event.params.pool_id[2],
        reserve_0: (pool?.reserve_0 ?? 0n) - event.params.asset_0_out,
        reserve_1: (pool?.reserve_1 ?? 0n) - event.params.asset_1_out,
        create_time: pool?.create_time ?? event.block.time,
        decimals_0: pool?.decimals_0,
        decimals_1: pool?.decimals_1,
    });
    const [address, isContract] = identityToStr(event.params.recipient);
    const transaction: Transaction = {
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
        lp_id: event.params.liquidity.id.bits,
        lp_amount: event.params.liquidity.amount,
        extra: undefined
    };
    await upsertTransaction(context, transaction);
});

Mira.SwapEvent.handler(async ({event, context}) => {
    const id = `${event.logIndex}_${event.transaction.id}_${event.block.height}`
    const rawEvent = {
        id: id,
        pool_id: poolIdToStr(event.params.pool_id),
        recipient: identityToStr(event.params.recipient)[0],
        asset_0_in: event.params.asset_0_in,
        asset_1_in: event.params.asset_1_in,
        asset_0_out: event.params.asset_0_out,
        asset_1_out: event.params.asset_1_out,
        logIndex: event.logIndex,
        transactionId: event.transaction.id,
        blockId: event.block.id,
        blockHeight: event.block.height
    };
    context.RawSwapEvent.set(rawEvent);

    context.log.info(`Handling SwapEvent for transaction ID: ${event.transaction.id}`);

    if (await shouldReturnEarlyDueToDuplicate(id, context)) {
        context.log.error(`Return Early due to duplicate in SwapEvent - tx: ${event.transaction.id}`);
        return;
    }

    const poolId = poolIdToStr(event.params.pool_id);

    const dailyTimestamp = new Date(event.block.time * 1000).setHours(0, 0, 0, 0) / 1000;
    const dailySnapshotId = `${poolId}_${dailyTimestamp}`

    const hourlyTimestamp = new Date(event.block.time * 1000).setMinutes(0, 0, 0) / 1000;
    const hourlySnapshotId = `${poolId}_${hourlyTimestamp}`

    const [pool, dailySnapshot, hourlySnapshot] = await Promise.all([
        context.Pool.get(poolId),
        context.SwapDaily.get(dailySnapshotId),
        context.SwapHourly.get(hourlySnapshotId),
    ]);

    if (pool === undefined) {
        context.log.error(`Pool ${poolId} not found but received SwapEvent`);
        return;
    }

    const updatedPool = {
        id: poolId,
        asset_0: event.params.pool_id[0].bits,
        asset_1: event.params.pool_id[1].bits,
        is_stable: event.params.pool_id[2],
        reserve_0: (pool?.reserve_0 ?? 0n) + event.params.asset_0_in - event.params.asset_0_out,
        reserve_1: (pool?.reserve_1 ?? 0n) + event.params.asset_1_in - event.params.asset_1_out,
        create_time: pool?.create_time ?? event.block.time,
        decimals_0: pool?.decimals_0,
        decimals_1: pool?.decimals_1,
    }

    context.Pool.set(updatedPool);

    const [address, isContract] = identityToStr(event.params.recipient);
    const transaction: Transaction = {
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
        lp_id: undefined,
        lp_amount: undefined,
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

    const k0 = kPool(pool);
    const updatedPoolSubtractFees = {
        ...updatedPool,
        reserve_0: updatedPool.reserve_0 - calculateFee(event.params.pool_id, event.params.asset_0_in, AMM_FEES),
        reserve_1: updatedPool.reserve_1 - calculateFee(event.params.pool_id, event.params.asset_1_in, AMM_FEES),
    };
    const k1 = kPool(updatedPoolSubtractFees);

    if (k1 < k0) {
        context.CurveViolation.set({
            asset_0_in: event.params.asset_0_in,
            asset_0_out: event.params.asset_0_out,
            asset_1_in: event.params.asset_1_in,
            asset_1_out: event.params.asset_1_out,
            id: uuid(),
            block_time: event.block.time,
            pool_id: poolId,
            reserve_0: pool.reserve_0,
            reserve_1: pool.reserve_1,
            new_reserve_0: updatedPool.reserve_0,
            new_reserve_1: updatedPool.reserve_1,
            tx_id: event.transaction.id
        });
    }
});
