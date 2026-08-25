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

        // ----- 构建用户过滤条件 -----
        let userCondition = '';
        const params = [];
        if (role === 'trader') {
            userCondition = 'AND username = ?';
            params.push(username);
        } else if (role === 'admin' && targetUser) {
            userCondition = 'AND username = ?';
            params.push(targetUser);
        } else if (role === 'admin' && !targetUser) {
            // 管理员查看全部：仅统计交易员
            userCondition = 'AND username IN (SELECT username FROM users WHERE role = ?)';
            params.push('trader');
        }

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
        const { results: kpiResults } = await db.prepare(kpiQuery).bind(...params).all();
        const kpi = kpiResults?.[0] || {};

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
        const { results: capitalResults } = await db.prepare(capitalQuery).bind(...capitalParams).all();
        const capitalResult = capitalResults?.[0] || {};
        const totalCapital = capitalResult.totalCapital || 0;

        // ----- 3. 月度盈亏 -----
        const monthQuery = `
            SELECT substr(date, 6, 2) as month, SUM(profit) as profit
            FROM trades
            WHERE close_price IS NOT NULL ${userCondition}
            GROUP BY substr(date, 6, 2)
            ORDER BY month
        `;
        const { results: monthResults } = await db.prepare(monthQuery).bind(...params).all();
        const monthMap = {};
        (monthResults || []).forEach(m => { monthMap[m.month] = m.profit; });
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
        const { results: dailyResults } = await db.prepare(dailyQuery).bind(...params).all();

        // ----- 5. 周净值（按自然周分组，使用 JS 处理，标签显示为 W01, W02...） -----
        const allTradesQuery = `
            SELECT date, profit
            FROM trades
            WHERE close_price IS NOT NULL ${userCondition}
            ORDER BY date
        `;
        const { results: allTrades } = await db.prepare(allTradesQuery).bind(...params).all();

        const weekMap = new Map();
        if (allTrades && allTrades.length > 0) {
            // 找出第一个日期
            const firstDate = new Date(allTrades[0].date);
            // 计算该日期所在周的周一（ISO 周一）
            const dayOfWeek = firstDate.getDay(); // 0=周日
            const diff = (dayOfWeek === 0 ? 6 : dayOfWeek - 1);
            const startOfWeek = new Date(firstDate);
            startOfWeek.setDate(firstDate.getDate() - diff);
            // 按周累计
            let currentWeekStart = new Date(startOfWeek);
            let weekProfit = 0;
            let weekIndex = 1;
            for (const trade of allTrades) {
                const tradeDate = new Date(trade.date);
                const weekDiff = (tradeDate - currentWeekStart) / (7 * 24 * 60 * 60 * 1000);
                if (weekDiff < 1) {
                    weekProfit += trade.profit || 0;
                } else {
                    const weekKey = `W${String(weekIndex).padStart(2, '0')}`;
                    weekMap.set(weekKey, weekProfit);
                    weekIndex++;
                    currentWeekStart = new Date(currentWeekStart);
                    currentWeekStart.setDate(currentWeekStart.getDate() + 7);
                    weekProfit = trade.profit || 0;
                }
            }
            // 保存最后一周
            const lastWeekKey = `W${String(weekIndex).padStart(2, '0')}`;
            weekMap.set(lastWeekKey, weekProfit);
        }

        // 构造净值倍数序列
        const weekLabels = ['初始'];
        const weeklyEquity = [1.0];
        let cumProfit = 0;
        const sortedWeeks = Array.from(weekMap.keys()).sort((a, b) => {
            const numA = parseInt(a.slice(1));
            const numB = parseInt(b.slice(1));
            return numA - numB;
        });
        for (const weekKey of sortedWeeks) {
            cumProfit += weekMap.get(weekKey) || 0;
            const equity = totalCapital > 0 ? (totalCapital + cumProfit) / totalCapital : 1;
            weeklyEquity.push(parseFloat(equity.toFixed(4)));
            weekLabels.push(weekKey);
        }

        // 如果没有任何周数据，保留默认两点
        if (weeklyEquity.length === 1) {
            weeklyEquity.push(1.0);
            weekLabels.push('当前');
        }

        // ----- 6. 组装返回 -----
        const response = {
            kpi: {
                totalTrades: kpi.totalTrades || 0,
                winTrades: kpi.winTrades || 0,
                totalProfit: kpi.totalProfit || 0,
                totalFee: kpi.totalFee || 0,
                totalWin: kpi.totalWin || 0,
                totalLoss: kpi.totalLoss || 0,
                totalCapital: totalCapital,
            },
            monthly: {
                labels: ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'],
                data: monthlyProfit,
            },
            daily: {
                labels: (dailyResults || []).map(d => d.date),
                data: (dailyResults || []).map(d => d.profit || 0),
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
