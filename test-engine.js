// 業務邏輯與工時試算單元測試 (Unit Tests for Business Logic)
const SYSTEM_CONFIG = {
  WORK_START: "08:30",
  WORK_END: "18:00",
  LUNCH_START: "12:00",
  LUNCH_END: "13:30",
  DAILY_WORK_HOURS: 8.0,
  MORNING_WORK_HOURS: 3.5,
  AFTERNOON_WORK_HOURS: 4.5,
  MULTI_TIER_THRESHOLD_HOURS: 24.0,
  CURRENT_YEAR: 2026,
  LEAVE_TYPES: [
    { id: "ANNUAL", name: "特休假", minUnit: 0.5, requiresAttachment: false, isPaid: true },
    { id: "COMP", name: "補休假", minUnit: 0.5, requiresAttachment: false, isPaid: true },
    { id: "PERSONAL", name: "事假", minUnit: 0.5, requiresAttachment: false, isPaid: false },
    { id: "SICK", name: "病假", minUnit: 0.5, requiresAttachment: true, isPaid: true }
  ],
  DEFAULT_HOLIDAYS: [
    { date: "2026-01-01", name: "元旦", is_workday: false },
    { date: "2026-09-25", name: "中秋節", is_workday: false }
  ]
};

const LeaveEngine = {
  calculateHours(startInput, endInput, holidays = []) {
    if (!startInput || !endInput) return 0;
    const startDate = new Date(startInput);
    const endDate = new Date(endInput);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return 0;
    if (endDate <= startDate) return 0;

    const holidayMap = {};
    const holidayList = (holidays && holidays.length > 0) ? holidays : SYSTEM_CONFIG.DEFAULT_HOLIDAYS;
    holidayList.forEach(h => {
      const dKey = typeof h.date === "string" ? h.date.substring(0, 10) : LeaveEngine.formatDateOnly(new Date(h.date));
      holidayMap[dKey] = (h.is_workday === true || h.is_workday === "true");
    });

    let totalHours = 0;
    let curr = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const lastDay = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

    while (curr <= lastDay) {
      const dateKey = LeaveEngine.formatDateOnly(curr);
      const dayOfWeek = curr.getDay(); // 0: 週日, 6: 週六

      let isWorkDay = (dayOfWeek !== 0 && dayOfWeek !== 6);
      if (holidayMap[dateKey] !== undefined) {
        isWorkDay = holidayMap[dateKey];
      }

      if (isWorkDay) {
        const isStartDay = (LeaveEngine.formatDateOnly(curr) === LeaveEngine.formatDateOnly(startDate));
        const isEndDay = (LeaveEngine.formatDateOnly(curr) === LeaveEngine.formatDateOnly(endDate));

        let dayStartVal = 8.5; // 08:30
        let dayEndVal = 18.0;  // 18:00

        if (isStartDay) {
          const sHour = startDate.getHours() + startDate.getMinutes() / 60;
          dayStartVal = Math.max(8.5, sHour);
        }
        if (isEndDay) {
          const eHour = endDate.getHours() + endDate.getMinutes() / 60;
          dayEndVal = Math.min(18.0, eHour);
        }

        if (dayEndVal > dayStartVal) {
          let dayWorkTime = 0;
          // 上午 08:30 ~ 12:00
          const mStart = Math.max(8.5, dayStartVal);
          const mEnd = Math.min(12.0, dayEndVal);
          if (mEnd > mStart) {
            dayWorkTime += (mEnd - mStart);
          }
          // 下午 13:30 ~ 18:00
          const aStart = Math.max(13.5, dayStartVal);
          const aEnd = Math.min(18.0, dayEndVal);
          if (aEnd > aStart) {
            dayWorkTime += (aEnd - aStart);
          }
          totalHours += dayWorkTime;
        }
      }

      curr.setDate(curr.getDate() + 1);
    }

    return Math.round(totalHours * 10) / 10;
  },

  checkOverlapping(startInput, endInput, existingRequests = [], userId) {
    const newStart = new Date(startInput).getTime();
    const newEnd = new Date(endInput).getTime();
    for (const req of existingRequests) {
      if (req.user_id !== userId) continue;
      if (["PENDING", "APPROVED", "CANCEL_PENDING"].indexOf(req.status) === -1) continue;
      const rStart = new Date(req.start_time).getTime();
      const rEnd = new Date(req.end_time).getTime();
      if (Math.max(newStart, rStart) < Math.min(newEnd, rEnd)) {
        return { hasOverlap: true, conflictedRequest: req };
      }
    }
    return { hasOverlap: false };
  },

  getApprovalRoute(totalHours, applicantUser, allUsers = []) {
    const isMultiTier = (totalHours > SYSTEM_CONFIG.MULTI_TIER_THRESHOLD_HOURS);
    return { isMultiTier };
  },

  calculateStatutoryAnnualLeave(hireDate, asOfDate = new Date()) {
    if (!hireDate) return { years: 0, months: 0, totalMonths: 0, days: 0, hours: 0 };
    const h = new Date(hireDate);
    const now = new Date(asOfDate);
    if (isNaN(h.getTime()) || h > now) return { years: 0, months: 0, totalMonths: 0, days: 0, hours: 0 };

    let years = now.getFullYear() - h.getFullYear();
    let months = now.getMonth() - h.getMonth();
    let daysDiff = now.getDate() - h.getDate();

    if (daysDiff < 0) {
      months -= 1;
    }
    if (months < 0) {
      years -= 1;
      months += 12;
    }
    const totalMonths = years * 12 + months;

    let statutoryDays = 0;
    if (totalMonths < 6) {
      statutoryDays = 0;
    } else if (totalMonths >= 6 && totalMonths < 12) {
      statutoryDays = 3;
    } else if (years === 1) {
      statutoryDays = 7;
    } else if (years === 2) {
      statutoryDays = 10;
    } else if (years >= 3 && years < 5) {
      statutoryDays = 14;
    } else if (years >= 5 && years < 10) {
      statutoryDays = 15;
    } else if (years >= 10) {
      const calculated = 15 + (years - 9);
      statutoryDays = Math.min(30, calculated);
    }

    return {
      years,
      months,
      totalMonths,
      days: statutoryDays,
      hours: statutoryDays * 8.0
    };
  },

  formatDateOnly(date) {
    if (!date) return "";
    const d = new Date(date);
    const year = d.getFullYear();
    const month = ("0" + (d.getMonth() + 1)).slice(-2);
    const day = ("0" + d.getDate()).slice(-2);
    return `${year}-${month}-${day}`;
  }
};

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

// 測試 9: 勞基法第38條特休假試算 - 未滿 6 個月 (3個月) -> 0 天 (0h)
const statUnder6m = LeaveEngine.calculateStatutoryAnnualLeave("2026-06-01", "2026-09-01");
assert(statUnder6m.days === 0 && statUnder6m.hours === 0, "未滿 6 個月特休應為 0 天");

// 測試 10: 勞基法第38條特休假試算 - 滿 6 個月未滿 1 年 -> 3 天 (24h)
const stat6m = LeaveEngine.calculateStatutoryAnnualLeave("2026-03-01", "2026-09-01");
assert(stat6m.days === 3 && stat6m.hours === 24.0, "滿 6 個月未滿 1 年特休應為 3 天 (24h)");

// 測試 11: 勞基法第38條特休假試算 - 滿 1 年未滿 2 年 -> 7 天 (56h)
const stat1y = LeaveEngine.calculateStatutoryAnnualLeave("2025-03-01", "2026-09-01");
assert(stat1y.days === 7 && stat1y.hours === 56.0, "滿 1 年未滿 2 年特休應為 7 天 (56h)");

// 測試 12: 勞基法第38條特休假試算 - 滿 2 年未滿 3 年 -> 10 天 (80h)
const stat2y = LeaveEngine.calculateStatutoryAnnualLeave("2024-03-01", "2026-09-01");
assert(stat2y.days === 10 && stat2y.hours === 80.0, "滿 2 年未滿 3 年特休應為 10 天 (80h)");

// 測試 13: 勞基法第38條特休假試算 - 滿 3 年未滿 5 年 -> 14 天 (112h)
const stat3y = LeaveEngine.calculateStatutoryAnnualLeave("2023-03-01", "2026-09-01");
assert(stat3y.days === 14 && stat3y.hours === 112.0, "滿 3 年未滿 5 年特休應為 14 天 (112h)");

// 測試 14: 勞基法第38條特休假試算 - 滿 5 年未滿 10 年 -> 15 天 (120h)
const stat5y = LeaveEngine.calculateStatutoryAnnualLeave("2021-03-01", "2026-09-01");
assert(stat5y.days === 15 && stat5y.hours === 120.0, "滿 5 年未滿 10 年特休應為 15 天 (120h)");

// 測試 15: 勞基法第38條特休假試算 - 滿 10 年 (10年) -> 16 天 (128h)
const stat10y = LeaveEngine.calculateStatutoryAnnualLeave("2016-03-01", "2026-09-01");
assert(stat10y.days === 16 && stat10y.hours === 128.0, "滿 10 年特休應為 16 天 (128h)");

// 測試 16: 勞基法第38條特休假試算 - 滿 25 年 -> 上限最高 30 天 (240h)
const stat25y = LeaveEngine.calculateStatutoryAnnualLeave("2001-03-01", "2026-09-01");
assert(stat25y.days === 30 && stat25y.hours === 240.0, "滿 25 年特休應達法定上限 30 天 (240h)");

console.log("🎉 所有業務核心邏輯與勞基法特休試算單元測試全數通過！");
