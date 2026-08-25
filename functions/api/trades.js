import { verifyJWT } from '../_utils';

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

    // ===== GET =====
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
        return new Response(JSON.stringify(results), {
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // ===== POST 单条 =====
    if (request.method === 'POST' && !pathname.endsWith('/batch')) {
        const tradeData = await request.json();
        let targetUser = tradeData.username;
        if (role === 'trader') targetUser = username;
        else if (role === 'admin' && !targetUser) {
            return new Response(JSON.stringify({ error: '管理员必须指定交易员用户名' }), { status: 400 });
        } else if (!targetUser) targetUser = username;

        const { success } = await db.prepare(
            `INSERT INTO trades 
            (username, date, symbol, direction, stop_loss, open_price, volume, close_price, 
             profit, profit_points, open_fee, close_fee, point_value, tick_size)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
            targetUser, tradeData.date, tradeData.symbol, tradeData.direction,
            tradeData.stop_loss || null, tradeData.open_price, tradeData.volume,
            tradeData.close_price || null,
            tradeData.profit || 0, tradeData.profit_points || 0,
            tradeData.open_fee || 0, tradeData.close_fee || 0,
            tradeData.point_value || 0, tradeData.tick_size || 0
        ).run();
        if (success) {
            const { results } = await db.prepare('SELECT * FROM trades ORDER BY id DESC LIMIT 1').all();
            return new Response(JSON.stringify(results[0]), { headers: { 'Content-Type': 'application/json' } });
        } else {
            return new Response(JSON.stringify({ error: '插入失败' }), { status: 500 });
        }
    }

    // ===== POST 批量 =====
    if (request.method === 'POST' && pathname.endsWith('/batch')) {
        const trades = await request.json();
        if (!Array.isArray(trades) || trades.length === 0) {
            return new Response(JSON.stringify({ error: '请提供交易数组' }), { status: 400 });
        }
        let inserted = 0;
        for (const item of trades) {
            let targetUser = item.username;
            if (role === 'trader') targetUser = username;
            else if (role === 'admin' && !targetUser) continue;
            else if (!targetUser) targetUser = username;

            const { success } = await db.prepare(
                `INSERT INTO trades 
                (username, date, symbol, direction, stop_loss, open_price, volume, close_price, 
                 profit, profit_points, open_fee, close_fee, point_value, tick_size)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
                targetUser, item.date, item.symbol, item.direction,
                item.stop_loss || null, item.open_price, item.volume,
                item.close_price || null,
                item.profit || 0, item.profit_points || 0,
                item.open_fee || 0, item.close_fee || 0,
                item.point_value || 0, item.tick_size || 0
            ).run();
            if (success) inserted++;
        }
        return new Response(JSON.stringify({ inserted, total: trades.length }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // ===== PUT 更新单条 =====
    if (request.method === 'PUT') {
        // 路径格式 /api/trades/123
        const id = pathname.split('/').pop();
        if (!id || isNaN(id)) {
            return new Response(JSON.stringify({ error: '无效的 ID' }), { status: 400 });
        }
        // 权限检查
        const check = await db.prepare('SELECT username FROM trades WHERE id = ?').bind(id).first();
        if (!check) return new Response(JSON.stringify({ error: '记录不存在' }), { status: 404 });
        if (role === 'trader' && check.username !== username) {
            return new Response(JSON.stringify({ error: '无权修改' }), { status: 403 });
        }

        const tradeData = await request.json();
        const result = await db.prepare(
            `UPDATE trades SET 
            date = ?, symbol = ?, direction = ?, stop_loss = ?, open_price = ?, volume = ?,
            close_price = ?, profit = ?, profit_points = ?, open_fee = ?, close_fee = ?,
            point_value = ?, tick_size = ?
            WHERE id = ?`
        ).bind(
            tradeData.date, tradeData.symbol, tradeData.direction,
            tradeData.stop_loss || null, tradeData.open_price, tradeData.volume,
            tradeData.close_price || null,
            tradeData.profit || 0, tradeData.profit_points || 0,
            tradeData.open_fee || 0, tradeData.close_fee || 0,
            tradeData.point_value || 0, tradeData.tick_size || 0,
            id
        ).run();
        if (result.success) {
            const { results } = await db.prepare('SELECT * FROM trades WHERE id = ?').bind(id).all();
            return new Response(JSON.stringify(results[0]), { headers: { 'Content-Type': 'application/json' } });
        } else {
            return new Response(JSON.stringify({ error: '更新失败' }), { status: 500 });
        }
    }

    // ===== DELETE =====
    if (request.method === 'DELETE') {
        const id = pathname.split('/').pop();
        // 如果路径包含数字ID，删除单条
        if (id && !isNaN(id)) {
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
        } else {
            // 清空（仅管理员）
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
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
}
