import { verifyJWT } from '../../_utils';

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
    if (request.method === 'POST') {
        const tradeData = await request.json();
        let targetUser = tradeData.username;
        if (role === 'trader') targetUser = username;
        else if (role === 'admin' && !targetUser) {
            return new Response(JSON.stringify({ error: '管理员必须指定交易员用户名' }), { status: 400 });
        } else if (!targetUser) targetUser = username;

        // 获取品种配置
        const symbolConfig = await db.prepare('SELECT point_value, tick_size, open_fee_rate, close_fee_rate FROM symbols WHERE symbol = ?').bind(tradeData.symbol).first();
        if (!symbolConfig) {
            return new Response(JSON.stringify({ error: '品种不存在，请先在数据维护中添加' }), { status: 400 });
        }

        const { point_value, tick_size, open_fee_rate, close_fee_rate } = symbolConfig;
        let profit = 0;
        let profit_points = 0;
        let open_fee = 0;
        let close_fee = 0;
        const closePrice = tradeData.close_price || null;

        if (closePrice !== null && !isNaN(closePrice)) {
            // 计算盈亏点数
            if (tradeData.direction === '买入') {
                profit_points = (closePrice - tradeData.open_price) / tick_size * tradeData.volume;
            } else if (tradeData.direction === '卖出') {
                profit_points = (tradeData.open_price - closePrice) / tick_size * tradeData.volume;
            }
            // 计算手续费（注意：这里简单计算，实际可能更复杂，但沿用原逻辑）
            open_fee = tradeData.open_price * tradeData.volume * open_fee_rate;
            close_fee = closePrice * tradeData.volume * close_fee_rate;
            // 计算盈亏金额
            profit = profit_points * point_value * tradeData.volume - open_fee - close_fee;
        }

        const { success } = await db.prepare(
            `INSERT INTO trades 
            (username, date, symbol, direction, stop_loss, open_price, volume, close_price, 
             profit, profit_points, open_fee, close_fee, point_value, tick_size)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
            targetUser,
            tradeData.date,
            tradeData.symbol,
            tradeData.direction,
            tradeData.stop_loss || null,
            tradeData.open_price,
            tradeData.volume,
            closePrice,
            profit,
            profit_points,
            open_fee,
            close_fee,
            point_value,
            tick_size
        ).run();

        if (success) {
            const { results } = await db.prepare('SELECT * FROM trades ORDER BY id DESC LIMIT 1').all();
            return new Response(JSON.stringify(results[0]), { headers: { 'Content-Type': 'application/json' } });
        } else {
            return new Response(JSON.stringify({ error: '插入失败' }), { status: 500 });
        }
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
