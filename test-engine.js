// 業務邏輯與工時試算單元測試 (Unit Tests for Business Logic)
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const sandbox = { console, Math, Date, parseFloat, parseInt, Number, String, RegExp, Array, Object, isNaN };
sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "js/config.js"), "utf8") + "\nthis.SYSTEM_CONFIG = SYSTEM_CONFIG;", sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "js/engine.js"), "utf8") + "\nthis.LeaveEngine = LeaveEngine;", sandbox);
const SYSTEM_CONFIG = sandbox.SYSTEM_CONFIG;
const LeaveEngine = sandbox.LeaveEngine;

// 執行測試
console.log("=== 開始執行請假系統工時與防呆邏輯驗證 ===");

function assert(condition, name) {
  if (condition) {
    console.log(`✅ 通過測試: ${name}`);
  } else {
    console.error(`❌ 測試失敗: ${name}`);
    process.exit(1);
  }
}

// 測試 1: 全天請假工時 (08:30 - 18:00, 午休 1.5h 扣除) -> 8.0h
const fullDay = LeaveEngine.calculateHours("2026-09-01 08:30", "2026-09-01 18:00");
assert(fullDay === 8.0, `全天工時應為 8.0 小時，實際值: ${fullDay}`);

// 測試 2: 上半天工時 (08:30 - 12:00) -> 3.5h
const morning = LeaveEngine.calculateHours("2026-09-01 08:30", "2026-09-01 12:00");
assert(morning === 3.5, `上半天工時應為 3.5 小時，實際值: ${morning}`);

// 測試 3: 下半天工時 (13:30 - 18:00) -> 4.5h
const afternoon = LeaveEngine.calculateHours("2026-09-01 13:30", "2026-09-01 18:00");
assert(afternoon === 4.5, `下半天工時應為 4.5 小時，實際值: ${afternoon}`);

// 測試 4: 午休時段內請假 (12:00 - 13:30) -> 0.0h
const lunchOnly = LeaveEngine.calculateHours("2026-09-01 12:00", "2026-09-01 13:30");
assert(lunchOnly === 0.0, `午休時段請假工時應為 0.0 小時，實際值: ${lunchOnly}`);

// 測試 5: 跨週末 (週五 08:30 至 下週一 18:00) -> 2 個工作天 = 16.0h
const crossWeekend = LeaveEngine.calculateHours("2026-09-04 08:30", "2026-09-07 18:00");
assert(crossWeekend === 16.0, `跨週末 2 工作天工時應為 16.0 小時，實際值: ${crossWeekend}`);

// 測試 6: 國定假日排除 (中秋節 2026-09-25 週五)
const holidayTest = LeaveEngine.calculateHours("2026-09-25 08:30", "2026-09-25 18:00");
assert(holidayTest === 0.0, `國定假日工時應為 0.0 小時，實際值: ${holidayTest}`);

// 測試 7: 重疊時段衝突檢核
const existingReqs = [
  { id: "REQ-001", user_id: "EMP001", start_time: "2026-09-10 08:30", end_time: "2026-09-10 18:00", status: "APPROVED" }
];
const overlapRes = LeaveEngine.checkOverlapping("2026-09-10 13:30", "2026-09-10 18:00", existingReqs, "EMP001");
assert(overlapRes.hasOverlap === true, "重疊請假時段應被精準檢測出衝突");

const noOverlapRes = LeaveEngine.checkOverlapping("2026-09-11 08:30", "2026-09-11 18:00", existingReqs, "EMP001");
assert(noOverlapRes.hasOverlap === false, "未重疊時段應檢測為無衝突");

// 測試 8: 多階審核判定 (<= 24h 單簽 vs > 24h 雙簽)
const routeSingle = LeaveEngine.getApprovalRoute(24.0, { manager_id: "EMP002" });
assert(routeSingle.isMultiTier === false, "24 小時以內應為單階主管審核");

const routeMulti = LeaveEngine.getApprovalRoute(32.0, { manager_id: "EMP002" });
assert(routeMulti.isMultiTier === true, "超過 24 小時 (3天) 應為主管+HR雙階審核");

// 測試 9: 勞基法歷年制特休假試算 - 當年 2026-08-01 到職 (未滿6個月) -> 0 天 (0h)
const statUnder6m = LeaveEngine.calculateStatutoryAnnualLeave("2026-08-01", 2026);
assert(statUnder6m.days === 0 && statUnder6m.hours === 0, `當年度未滿 6 個月特休應為 0 天，實際值: ${statUnder6m.days}`);

// 測試 10: 勞基法歷年制特休假試算 - 當年 2026-02-01 到職 (滿6個月可取得3天)
const stat6m = LeaveEngine.calculateStatutoryAnnualLeave("2026-02-01", 2026);
assert(stat6m.days === 3 && stat6m.hours === 24.0, `當年度滿 6 個月特休應為 3 天 (24h)，實際值: ${stat6m.days}`);

// 測試 11: 勞基法歷年制特休假試算 - 2024-03-01 到職於 2026 年度歷年制比例分段核算 (約 9.5 天)
const stat2024 = LeaveEngine.calculateStatutoryAnnualLeave("2024-03-01", 2026);
assert(stat2024.days >= 9.0 && stat2024.days <= 10.0, `2024-03-01到職在2026歷年制特休應為 ~9.5 天，實際值: ${stat2024.days}`);

// 測試 12: 勞基法歷年制特休假試算 - 2023-01-15 到職於 2026 年度歷年制比例分段核算 (約 13.8 天)
const stat2023 = LeaveEngine.calculateStatutoryAnnualLeave("2023-01-15", 2026);
assert(stat2023.days >= 13.0 && stat2023.days <= 14.0, `2023-01-15到職在2026歷年制特休應為 ~13.8 天，實際值: ${stat2023.days}`);

// 測試 13: 勞基法歷年制特休假試算 - 2020-07-01 到職於 2026 年度歷年制核算 (15 天)
const stat2020 = LeaveEngine.calculateStatutoryAnnualLeave("2020-07-01", 2026);
assert(stat2020.days === 15.0 && stat2020.hours === 120.0, `2020-07-01到職在2026歷年制特休應為 15 天 (120h)，實際值: ${stat2020.days}`);

// 測試 14: 管理者與人資全域權限判定 (EMP001, Admin, HR, 管理者, 管理部)
assert(LeaveEngine.isUserAdmin({ id: "EMP001", role: "Admin", department_name: "管理部" }) === true, "EMP001 應被判定為 Admin 管理者權限");
assert(LeaveEngine.isUserAdmin({ id: "EMP003", role: "HR", department_name: "人資部" }) === true, "HR 應被判定為 Admin 管理者權限");
assert(LeaveEngine.isUserAdmin({ id: "EMP004", role: "管理者", department_name: "業務部" }) === true, "中文『管理者』角色應被判定為 Admin 管理者權限");
assert(LeaveEngine.isUserAdmin({ id: "EMP005", role: "Employee", department_name: "研發部" }) === false, "一般員工不應被判定為 Admin");
assert(LeaveEngine.isUserManager({ id: "EMP002", role: "Manager", department_name: "研發部" }) === true, "部門主管應被判定為 Manager 權限");
assert(LeaveEngine.isUserManager({ id: "EMP003", role: "HR", department_name: "人資部" }) === false, "HR 人員不應被判定為 Manager 權限");
assert(LeaveEngine.isUserManager({ id: "EMP012", role: "Employee", department_name: "管理部" }) === false, "管理部一般同仁 EMP012 不應被判定為 Manager 權限");

console.log("🎉 所有業務核心邏輯、勞基法【歷年制】特休與角色權限劃分單元測試全數通過！");
