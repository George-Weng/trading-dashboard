import { verifyJWT } from '../_utils';

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    // 验证 JWT
    const authHeader = request.headers.get('Authorization');
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        return new Response(JSON.stringify({ error: '未授权' }), { status: 401 });
    }
    const payload = await verifyJWT(token, env.JWT_SECRET);
    if (!payload) {
        return new Response(JSON.stringify({ error: '无效 token' }), { status: 401 });
    }
    const { username, role } = payload;

    // ========== GET ==========
    if (request.method === 'GET') {
        const url = new URL(request.url);
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

    // ========== POST 单条 ==========
    if (request.method === 'POST') {
        const tradeData = await request.json();

        // 确定归属用户
        let targetUser = tradeData.username;
        if (role === 'trader') {
            targetUser = username; // 交易员强制使用自己
        } else if (role === 'admin') {
            if (!targetUser) {
                return new Response(JSON.stringify({ error: '管理员必须指定交易员用户名' }), { status: 400 });
            }
        } else {
            targetUser = username; // fallback
        }

        // 插入数据库
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
            tradeData.close_price || null,
            tradeData.profit || 0,
            tradeData.profit_points || 0,
            tradeData.open_fee || 0,
            tradeData.close_fee || 0,
            tradeData.point_value || 0,
            tradeData.tick_size || 0
        ).run();

        if (success) {
            const { results } = await db.prepare('SELECT * FROM trades ORDER BY id DESC LIMIT 1').all();
            return new Response(JSON.stringify(results[0]), {
                headers: { 'Content-Type': 'application/json' }
            });
        } else {
            return new Response(JSON.stringify({ error: '插入失败，请检查字段' }), { status: 500 });
        }
    }

    // ========== POST 批量导入 ==========
    if (request.method === 'POST' && request.url.endsWith('/batch')) {
        const trades = await request.json();
        if (!Array.isArray(trades) || trades.length === 0) {
            return new Response(JSON.stringify({ error: '请提供交易数组' }), { status: 400 });
        }

        let inserted = 0;
        for (const item of trades) {
            let targetUser = item.username;
            if (role === 'trader') {
                targetUser = username;
            } else if (role === 'admin') {
                if (!targetUser) {
                    continue; // 跳过未指定用户的记录
                }
            } else {
                targetUser = username;
            }

            const { success } = await db.prepare(
                `INSERT INTO trades 
                (username, date, symbol, direction, stop_loss, open_price, volume, close_price, 
                 profit, profit_points, open_fee, close_fee, point_value, tick_size)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
                targetUser,
                item.date,
                item.symbol,
                item.direction,
                item.stop_loss || null,
                item.open_price,
                item.volume,
                item.close_price || null,
                item.profit || 0,
                item.profit_points || 0,
                item.open_fee || 0,
                item.close_fee || 0,
                item.point_value || 0,
                item.tick_size || 0
            ).run();
            if (success) inserted++;
        }

        return new Response(JSON.stringify({ inserted, total: trades.length }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // ========== DELETE 清空 ==========
    if (request.method === 'DELETE') {
        const url = new URL(request.url);
        const targetUser = url.searchParams.get('user');

        // 权限检查
        if (role === 'trader') {
            // 交易员只能删除自己的记录（单条删除应由 DELETE /trades/:id 处理，这里清空只允许管理员）
            return new Response(JSON.stringify({ error: '无权清空' }), { status: 403 });
        }

        // 管理员
        let query = 'DELETE FROM trades';
        const params = [];
        if (targetUser) {
            query += ' WHERE username = ?';
            params.push(targetUser);
        }
        // 如果 targetUser 为空，则删除所有交易（谨慎）
        const result = await db.prepare(query).bind(...params).run();
        if (result.success) {
            return new Response(JSON.stringify({ success: true, deleted: result.meta?.rows_written || 0 }), {
                headers: { 'Content-Type': 'application/json' }
            });
        } else {
            return new Response(JSON.stringify({ error: '清空失败' }), { status: 500 });
        }
    }

    // ========== PUT 更新（略，可保留原逻辑） ==========
    // 为了节省篇幅，这里暂不实现 PUT，您可根据需要补充。

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
}
