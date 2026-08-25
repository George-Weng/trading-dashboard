import { verifyJWT } from '../_utils';

export async function onRequest(context) {
    try {
        const { request, env } = context;
        const db = env.DB;

        // 验证 JWT
        const authHeader = request.headers.get('Authorization');
        const token = authHeader && authHeader.split(' ')[1];
        if (!token) return new Response(JSON.stringify({ error: '未授权' }), { status: 401 });
        const payload = await verifyJWT(token, env.JWT_SECRET);
        if (!payload) return new Response(JSON.stringify({ error: '无效 token' }), { status: 401 });
        const { username, role } = payload;

        const url = new URL(request.url);
        const targetUser = url.searchParams.get('user');

        let userCondition = '';
        const params = [];
        if (role === 'trader') {
            userCondition = 'AND username = ?';
            params.push(username);
        } else if (role === 'admin' && targetUser) {
            userCondition = 'AND username = ?';
            params.push(targetUser);
        }
        // 管理员且未指定用户，统计所有交易员（userCondition 为空）

        // ----- 1. KPI（仅已平仓） -----
        const kpiQuery = `
            SELECT 
                COUNT(*) as totalTrades,
                SUM(CASE WHEN profit > 0 THEN 1 ELSE 0 END) as winTrades,
                SUM(profit) as totalProfit,
                SUM(open_fee + close_fee) as totalFee,
                SUM(CASE WHEN profit > 0 THEN profit ELSE 0 END) as totalWin,
                SUM(CASE WHEN profit < 0 THEN -profit ELSE 0 END) as totalLoss
            FROM trades
            WHERE close_price IS NOT NULL ${userCondition}
        `;
        const kpi = await db.prepare(kpiQuery).bind(...params).first();

        // ----- 2. 总资本 -----
        let capitalQuery = 'SELECT SUM(initial_capital) as totalCapital FROM users WHERE role = ?';
        const capitalParams = ['trader'];
        if (role === 'trader') {
            capitalQuery += ' AND username = ?';
            capitalParams.push(username);
        } else if (role === 'admin' && targetUser) {
            capitalQuery += ' AND username = ?';
            capitalParams.push(targetUser);
        }
        const capitalResult = await db.prepare(capitalQuery).bind(...capitalParams).first();
        const totalCapital = capitalResult?.totalCapital || 0;

        // ----- 3. 月度盈亏（使用 substr 提取月份，避免 strftime 兼容问题） -----
        const monthQuery = `
            SELECT substr(date, 6, 2) as month, SUM(profit) as profit
            FROM trades
            WHERE close_price IS NOT NULL ${userCondition}
            GROUP BY substr(date, 6, 2)
            ORDER BY month
        `;
        const monthResults = await db.prepare(monthQuery).bind(...params).all();
        const monthMap = {};
        monthResults.forEach(m => { monthMap[m.month] = m.profit; });
        const monthlyProfit = [];
        for (let i = 1; i <= 12; i++) {
            const key = String(i).padStart(2, '0');
            monthlyProfit.push(monthMap[key] || 0);
        }

        // ----- 4. 每日盈亏（近30天） -----
        const dailyQuery = `
            SELECT date, SUM(profit) as profit
            FROM trades
            WHERE close_price IS NOT NULL ${userCondition}
            AND date >= date('now', '-30 days')
            GROUP BY date
            ORDER BY date
        `;
        const dailyResults = await db.prepare(dailyQuery).bind(...params).all();

        // ----- 5. 周净值（暂时简化，留空以免出错） -----
        const weekLabels = ['初始'];
        const weeklyEquity = [1.0];

        // ----- 6. 组装返回 -----
        const response = {
            kpi: {
                totalTrades: kpi?.totalTrades || 0,
                winTrades: kpi?.winTrades || 0,
                totalProfit: kpi?.totalProfit || 0,
                totalFee: kpi?.totalFee || 0,
                totalWin: kpi?.totalWin || 0,
                totalLoss: kpi?.totalLoss || 0,
                totalCapital: totalCapital,
            },
            monthly: {
                labels: ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'],
                data: monthlyProfit,
            },
            daily: {
                labels: dailyResults.map(d => d.date),
                data: dailyResults.map(d => d.profit || 0),
            },
            weekly: {
                labels: weekLabels,
                data: weeklyEquity,
            }
        };

        return new Response(JSON.stringify(response), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message, stack: err.stack }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
