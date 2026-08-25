import { verifyJWT } from '../../_utils';

// ---- 计算盈亏的工具函数 ----
async function calculateTrade(db, tradeData) {
    // 从 symbols 表获取品种配置
    const symbolConfig = await db.prepare('SELECT * FROM symbols WHERE symbol = ?').bind(tradeData.symbol).first();
    if (!symbolConfig) {
        // 如果找不到品种，无法计算，返回原数据（或抛出错误）
        return { ...tradeData, profit: 0, profit_points: 0, open_fee: 0, close_fee: 0, point_value: 0, tick_size: 0 };
    }
    const { point_value, tick_size, open_fee_rate, close_fee_rate } = symbolConfig;
    const openPrice = tradeData.open_price;
    const closePrice = tradeData.close_price;
    const volume = tradeData.volume;
    const direction = tradeData.direction;

    // 计算开平仓手续费
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

    // ===== GET 列表 =====
    if (request.method === 'GET') {
        const targetUser = url.searchParams.get('user');
        let query = 'SELECT * FROM trades';
        const params = [];
        if (role === 'trader') {
            query += ' WHERE username = ?';
            params.push(username);
        } else if (role === 'admin' && targetUser) {
            query += ' WHERE username = ?';
            params.push(targetUser);
        }
        query += ' ORDER BY date DESC, id DESC';
        const { results } = await db.prepare(query).bind(...params).all();
        return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
    }

    // ===== POST 新增（单条） =====
    if (request.method === 'POST' && !pathname.endsWith('/calculate-all')) {
        const tradeData = await request.json();
        let targetUser = tradeData.username;
        if (role === 'trader') targetUser = username;
        else if (role === 'admin' && !targetUser) {
            return new Response(JSON.stringify({ error: '管理员必须指定交易员用户名' }), { status: 400 });
        } else if (!targetUser) targetUser = username;

        // 计算盈亏
        const calculated = await calculateTrade(db, { ...tradeData, username: targetUser });

        const { success } = await db.prepare(
            `INSERT INTO trades 
            (username, date, symbol, direction, stop_loss, open_price, volume, close_price, 
             profit, profit_points, open_fee, close_fee, point_value, tick_size)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
            calculated.username,
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
            calculated.tick_size
        ).run();
        if (success) {
            const { results } = await db.prepare('SELECT * FROM trades ORDER BY id DESC LIMIT 1').all();
            return new Response(JSON.stringify(results[0]), { headers: { 'Content-Type': 'application/json' } });
        } else {
            return new Response(JSON.stringify({ error: '插入失败' }), { status: 500 });
        }
    }

    // ===== POST 批量计算所有交易（管理员专用） =====
    if (request.method === 'POST' && pathname.endsWith('/calculate-all')) {
        if (role !== 'admin') {
            return new Response(JSON.stringify({ error: '需要管理员权限' }), { status: 403 });
        }
        // 获取所有交易
        const { results: allTrades } = await db.prepare('SELECT * FROM trades').all();
        let updated = 0;
        for (const trade of allTrades) {
            const calculated = await calculateTrade(db, trade);
            // 更新
            const result = await db.prepare(
                `UPDATE trades SET 
                profit = ?, profit_points = ?, open_fee = ?, close_fee = ?,
                point_value = ?, tick_size = ?
                WHERE id = ?`
            ).bind(
                calculated.profit,
                calculated.profit_points,
                calculated.open_fee,
                calculated.close_fee,
                calculated.point_value,
                calculated.tick_size,
                trade.id
            ).run();
            if (result.success) updated++;
        }
        return new Response(JSON.stringify({ success: true, updated }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // ===== DELETE 清空 =====
    if (request.method === 'DELETE') {
        if (role !== 'admin') return new Response(JSON.stringify({ error: '权限不足' }), { status: 403 });
        const targetUser = url.searchParams.get('user');
        let query = 'DELETE FROM trades';
        const params = [];
        if (targetUser) { query += ' WHERE username = ?'; params.push(targetUser); }
        const result = await db.prepare(query).bind(...params).run();
        if (result.success) {
            return new Response(JSON.stringify({ success: true, deleted: result.meta?.rows_written || 0 }), {
                headers: { 'Content-Type': 'application/json' }
            });
        } else {
            return new Response(JSON.stringify({ error: '清空失败' }), { status: 500 });
        }
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
}
