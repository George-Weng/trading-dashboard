import { verifyJWT } from '../_utils';

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    const authHeader = request.headers.get('Authorization');
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return new Response('Unauthorized', { status: 401 });
    const payload = await verifyJWT(token, env.JWT_SECRET);
    if (!payload) return new Response('Unauthorized', { status: 401 });

    const { username, role } = payload;
    let whereClause = '';
    const params = [];
    if (role === 'trader') {
        whereClause = 'WHERE username = ?';
        params.push(username);
    }
    // 对于管理员，可以增加参数查看指定用户或全部，此处简化返回所有（管理员）
    // 实际应允许管理员选择查看范围，可传查询参数，这里略

    const query = `
        SELECT 
            COUNT(*) as totalTrades,
            SUM(CASE WHEN profit > 0 THEN 1 ELSE 0 END) as winTrades,
            SUM(profit) as totalProfit,
            SUM(open_fee + close_fee) as totalFee,
            SUM(initial_capital) as totalCapital
        FROM trades 
        LEFT JOIN users ON trades.username = users.username
        ${whereClause}
    `;
    const stats = await db.prepare(query).bind(...params).first();

    // 补充月度、每日数据（此处省略，可类似实现）
    return new Response(JSON.stringify(stats || {}), {
        headers: { 'Content-Type': 'application/json' }
    });
}
