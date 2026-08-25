import { verifyJWT } from '../../_utils';

// 复用相同的计算函数（为避免重复，可以抽离到 _utils.js，但为了独立，在此复制）
async function calculateTrade(db, tradeData) {
    const symbolConfig = await db.prepare('SELECT * FROM symbols WHERE symbol = ?').bind(tradeData.symbol).first();
    if (!symbolConfig) {
        return { ...tradeData, profit: 0, profit_points: 0, open_fee: 0, close_fee: 0, point_value: 0, tick_size: 0 };
    }
    const { point_value, tick_size, open_fee_rate, close_fee_rate } = symbolConfig;
    const openPrice = tradeData.open_price;
    const closePrice = tradeData.close_price;
    const volume = tradeData.volume;
    const direction = tradeData.direction;

    const openFee = openPrice * volume * open_fee_rate;
    const closeFee = closePrice ? closePrice * volume * close_fee_rate : 0;

    let profitPoints = 0;
    if (closePrice !== null && closePrice !== undefined) {
        if (direction === '买入') {
            profitPoints = (closePrice - openPrice) / tick_size * volume;
        } else if (direction === '卖出') {
            profitPoints = (openPrice - closePrice) / tick_size * volume;
        }
    }
    const profit = profitPoints * point_value * volume - openFee - closeFee;

    return {
        ...tradeData,
        profit: parseFloat(profit.toFixed(2)),
        profit_points: parseFloat(profitPoints.toFixed(2)),
        open_fee: parseFloat(openFee.toFixed(2)),
        close_fee: parseFloat(closeFee.toFixed(2)),
        point_value,
        tick_size,
    };
}

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    const authHeader = request.headers.get('Authorization');
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return new Response(JSON.stringify({ error: '未授权' }), { status: 401 });
    const payload = await verifyJWT(token, env.JWT_SECRET);
    if (!payload) return new Response(JSON.stringify({ error: '无效 token' }), { status: 401 });
    const { username, role } = payload;

    const url = new URL(request.url);
    const pathname = url.pathname;
    const id = pathname.split('/').pop();

    if (!id || isNaN(id)) {
        return new Response(JSON.stringify({ error: '无效的 ID' }), { status: 400 });
    }

    // ===== GET 单条 =====
    if (request.method === 'GET') {
        const { results } = await db.prepare('SELECT * FROM trades WHERE id = ?').bind(id).all();
        if (results.length === 0) return new Response(JSON.stringify({ error: '记录不存在' }), { status: 404 });
        return new Response(JSON.stringify(results[0]), { headers: { 'Content-Type': 'application/json' } });
    }

    // ===== PUT 更新 =====
    if (request.method === 'PUT') {
        const check = await db.prepare('SELECT username FROM trades WHERE id = ?').bind(id).first();
        if (!check) return new Response(JSON.stringify({ error: '记录不存在' }), { status: 404 });
        if (role === 'trader' && check.username !== username) {
            return new Response(JSON.stringify({ error: '无权修改' }), { status: 403 });
        }

        const tradeData = await request.json();
        // 计算盈亏（传入原有字段，但覆盖）
        const calculated = await calculateTrade(db, {
            ...tradeData,
            id: id, // 保留id用于更新
        });

        const result = await db.prepare(
            `UPDATE trades SET 
            date = ?, symbol = ?, direction = ?, stop_loss = ?, open_price = ?, volume = ?,
            close_price = ?, profit = ?, profit_points = ?, open_fee = ?, close_fee = ?,
            point_value = ?, tick_size = ?
            WHERE id = ?`
        ).bind(
            calculated.date,
            calculated.symbol,
            calculated.direction,
            calculated.stop_loss || null,
            calculated.open_price,
            calculated.volume,
            calculated.close_price || null,
            calculated.profit,
            calculated.profit_points,
            calculated.open_fee,
            calculated.close_fee,
            calculated.point_value,
            calculated.tick_size,
            id
        ).run();
        if (result.success) {
            const { results } = await db.prepare('SELECT * FROM trades WHERE id = ?').bind(id).all();
            return new Response(JSON.stringify(results[0]), { headers: { 'Content-Type': 'application/json' } });
        } else {
            return new Response(JSON.stringify({ error: '更新失败' }), { status: 500 });
        }
    }

    // ===== DELETE 单条 =====
    if (request.method === 'DELETE') {
        const check = await db.prepare('SELECT username FROM trades WHERE id = ?').bind(id).first();
        if (!check) return new Response(JSON.stringify({ error: '记录不存在' }), { status: 404 });
        if (role === 'trader' && check.username !== username) {
            return new Response(JSON.stringify({ error: '无权删除' }), { status: 403 });
        }
        const result = await db.prepare('DELETE FROM trades WHERE id = ?').bind(id).run();
        if (result.success) {
            return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        } else {
            return new Response(JSON.stringify({ error: '删除失败' }), { status: 500 });
        }
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
}
