import { verifyJWT } from '../_utils';

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    // 验证 JWT
    const authHeader = request.headers.get('Authorization');
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return new Response('Unauthorized', { status: 401 });
    const payload = await verifyJWT(token, env.JWT_SECRET);
    if (!payload) return new Response('Unauthorized', { status: 401 });

    const { username, role } = payload;
    const url = new URL(request.url);
    const targetUser = url.searchParams.get('user'); // 管理员可指定查看某交易员

    // ----- 1. 构建交易统计查询 -----
    let tradeWhere = '';
    let tradeParams = [];
    if (role === 'trader') {
        tradeWhere = 'WHERE username = ?';
        tradeParams.push(username);
    } else if (role === 'admin' && targetUser) {
        tradeWhere = 'WHERE username = ?';
        tradeParams.push(targetUser);
    }
    // 管理员不指定 user 时，统计全部交易员（不包含 admin）

    const statsQuery = `
        SELECT 
            COUNT(*) as totalTrades,
            SUM(CASE WHEN profit > 0 THEN 1 ELSE 0 END) as winTrades,
            SUM(profit) as totalProfit,
            SUM(open_fee + close_fee) as totalFee,
            SUM(CASE WHEN profit > 0 THEN profit ELSE 0 END) as totalWin,
            SUM(CASE WHEN profit < 0 THEN -profit ELSE 0 END) as totalLoss
        FROM trades
        ${tradeWhere}
    `;
    const stats = await db.prepare(statsQuery).bind(...tradeParams).first();

    // ----- 2. 查询总资本 -----
    let capitalWhere = '';
    let capitalParams = [];
    if (role === 'trader') {
        capitalWhere = 'AND username = ?';
        capitalParams.push(username);
    } else if (role === 'admin' && targetUser) {
        capitalWhere = 'AND username = ?';
        capitalParams.push(targetUser);
    }
    // 管理员不指定时，统计所有交易员（role = 'trader'）
    const capitalQuery = `
        SELECT SUM(initial_capital) as totalCapital 
        FROM users 
        WHERE role = 'trader' ${capitalWhere}
    `;
    const capitalResult = await db.prepare(capitalQuery).bind(...capitalParams).first();

    // ----- 3. 组装返回 -----
    const result = {
        totalTrades: stats?.totalTrades || 0,
        winTrades: stats?.winTrades || 0,
        totalProfit: stats?.totalProfit || 0,
        totalFee: stats?.totalFee || 0,
        totalWin: stats?.totalWin || 0,
        totalLoss: stats?.totalLoss || 0,
        totalCapital: capitalResult?.totalCapital || 0
    };

    return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
    });
}
