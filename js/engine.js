/**
 * 智慧請假計算核心引擎 (Leave Calculation & Validation Engine)
 */
const LeaveEngine = {
  /**
   * 計算請假工時
   * @param {string|Date} startInput 起始時間 (YYYY-MM-DD HH:mm)
   * @param {string|Date} endInput 結束時間 (YYYY-MM-DD HH:mm)
   * @param {Array} holidays 假日清單 [{date: 'YYYY-MM-DD', is_workday: false}]
   * @returns {number} 總請假工時 (小時)
   */
  calculateHours(startInput, endInput, holidays = []) {
    if (!startInput || !endInput) return 0;

    const startDate = new Date(startInput);
    const endDate = new Date(endInput);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return 0;
    if (endDate <= startDate) return 0;

    // 建立公休 Map
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

      // 判斷是否為應上班之工作日
      let isWorkDay = (dayOfWeek !== 0 && dayOfWeek !== 6);
      if (holidayMap[dateKey] !== undefined) {
        isWorkDay = holidayMap[dateKey];
      }

      if (isWorkDay) {
        const isStartDay = (LeaveEngine.formatDateOnly(curr) === LeaveEngine.formatDateOnly(startDate));
        const isEndDay = (LeaveEngine.formatDateOnly(curr) === LeaveEngine.formatDateOnly(endDate));

        // 當日標準工作起訖時間 (以小時為單位數值：8.5 代表 08:30，18.0 代表 18:00)
        let dayStartVal = 8.5;
        let dayEndVal = 18.0;

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

          // 區間一：上午 08:30 ~ 12:00 (最多 3.5 小時)
          const mStart = Math.max(8.5, dayStartVal);
          const mEnd = Math.min(12.0, dayEndVal);
          if (mEnd > mStart) {
            dayWorkTime += (mEnd - mStart);
          }

          // 區間二：下午 13:30 ~ 18:00 (最多 4.5 小時)
          const aStart = Math.max(13.5, dayStartVal);
          const aEnd = Math.min(18.0, dayEndVal);
          if (aEnd > aStart) {
            dayWorkTime += (aEnd - aStart);
          }

          totalHours += dayWorkTime;
        }
      }

      // 移至下一天
      curr.setDate(curr.getDate() + 1);
    }

    // 四捨五入至小數點第一位 (例如 0.5, 3.5, 8.0)
    return Math.round(totalHours * 10) / 10;
  },

  /**
   * 檢查時間是否與已存在的申請單重疊 (Overlapping Check)
   */
  checkOverlapping(startInput, endInput, existingRequests = [], userId, excludeRequestId = null) {
    if (!startInput || !endInput || !userId) return { hasOverlap: false };

    const newStart = new Date(startInput).getTime();
    const newEnd = new Date(endInput).getTime();

    for (const req of existingRequests) {
      if (req.user_id !== userId) continue;
      if (excludeRequestId && req.id === excludeRequestId) continue;
      // 僅檢核 生效中/審核中/銷假中的單據
      if (["PENDING", "APPROVED", "CANCEL_PENDING"].indexOf(req.status) === -1) continue;

      const reqStart = new Date(req.start_time).getTime();
      const reqEnd = new Date(req.end_time).getTime();

      // 重疊條件：Max(StartA, StartB) < Min(EndA, EndB)
      if (Math.max(newStart, reqStart) < Math.min(newEnd, reqEnd)) {
        return {
          hasOverlap: true,
          conflictedRequest: req
        };
      }
    }

    return { hasOverlap: false };
  },

  /**
   * 計算審核鏈路線與審核人
   */
  getApprovalRoute(totalHours, applicantUser, allUsers = []) {
    const isMultiTier = (totalHours > SYSTEM_CONFIG.MULTI_TIER_THRESHOLD_HOURS);
    
    // 直屬主管
    const manager = allUsers.find(u => u.id === (applicantUser ? applicantUser.manager_id : "")) || {
      id: "EMP002",
      name: "部門主管",
      role: "Manager"
    };

    // 人資 / 管理員 (HR)
    const hr = allUsers.find(u => u.role === "Admin" || u.department_id === "DEPT_HR") || {
      id: "EMP003",
      name: "林經理 (HR/Admin)",
      role: "Admin"
    };

    if (isMultiTier) {
      return {
        isMultiTier: true,
        summary: `多階審核：時數 ${totalHours} 小時 (> 3天 / 24h)，需經由【直屬主管】與【人資部門】雙階簽核。`,
        steps: [
          { step: "MANAGER", title: "第一階：部門直屬主管", approver: manager.name, approverId: manager.id },
          { step: "HR", title: "第二階：人力資源部 (HR)", approver: hr.name, approverId: hr.id }
        ]
      };
    } else {
      return {
        isMultiTier: false,
        summary: `單階審核：時數 ${totalHours} 小時 (<= 3天 / 24h)，由【直屬主管】簽核即可生效。`,
        steps: [
          { step: "MANAGER", title: "單一階層：部門直屬主管", approver: manager.name, approverId: manager.id }
        ]
      };
    }
  },

  /**
   * 依照台灣勞動基準法第38條計算特別休假 (Annual Leave based on Taiwan Labor Standards Act)
   * @param {string|Date} hireDate 到職日 (YYYY-MM-DD)
   * @param {string|Date} asOfDate 基準日 (預設為今日)
   * @returns {Object} { years, months, totalMonths, days, hours, description }
   */
  calculateStatutoryAnnualLeave(hireDate, asOfDate = new Date()) {
    if (!hireDate) return { years: 0, months: 0, totalMonths: 0, days: 0, hours: 0, description: "尚未設定到職日" };

    const h = new Date(hireDate);
    const now = new Date(asOfDate);
    if (isNaN(h.getTime()) || h > now) {
      return { years: 0, months: 0, totalMonths: 0, days: 0, hours: 0, description: "到職日無效或晚於當前日期" };
    }

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
    let tierDesc = "";

    // 勞基法第38條規定
    if (totalMonths < 6) {
      statutoryDays = 0;
      tierDesc = "未滿 6 個月：0 天";
    } else if (totalMonths >= 6 && totalMonths < 12) {
      statutoryDays = 3;
      tierDesc = "滿 6 個月以上未滿 1 年：3 天 (24 小時)";
    } else if (years === 1) {
      statutoryDays = 7;
      tierDesc = "滿 1 年以上未滿 2 年：7 天 (56 小時)";
    } else if (years === 2) {
      statutoryDays = 10;
      tierDesc = "滿 2 年以上未滿 3 年：10 天 (80 小時)";
    } else if (years >= 3 && years < 5) {
      statutoryDays = 14;
      tierDesc = "滿 3 年以上未滿 5 年：每年 14 天 (112 小時)";
    } else if (years >= 5 && years < 10) {
      statutoryDays = 15;
      tierDesc = "滿 5 年以上未滿 10 年：每年 15 天 (120 小時)";
    } else if (years >= 10) {
      // 滿 10 年以上：每滿 1 年加給 1 天，加至 30 天為止
      const calculated = 15 + (years - 9);
      statutoryDays = Math.min(30, calculated);
      tierDesc = `滿 10 年以上 (滿 ${years} 年)：${statutoryDays} 天 (${statutoryDays * 8} 小時)`;
    }

    const statutoryHours = statutoryDays * 8.0;

    return {
      years,
      months,
      totalMonths,
      days: statutoryDays,
      hours: statutoryHours,
      tierDesc,
      seniorityText: `${years} 年 ${months} 個月`,
      description: `年資 ${years} 年 ${months} 個月，依勞基法第38條核給特休 ${statutoryDays} 天 (${statutoryHours} 小時)`
    };
  },

  /**
   * 格式化日期 YYYY-MM-DD
   */
  formatDateOnly(date) {
    if (!date) return "";
    if (typeof date === "string") {
      const match = date.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
      if (match) {
        const y = match[1];
        const m = ("0" + match[2]).slice(-2);
        const d = ("0" + match[3]).slice(-2);
        return `${y}-${m}-${d}`;
      }
    }
    const d = new Date(date);
    if (isNaN(d.getTime())) return "";
    const year = d.getFullYear();
    const month = ("0" + (d.getMonth() + 1)).slice(-2);
    const day = ("0" + d.getDate()).slice(-2);
    return `${year}-${month}-${day}`;
  },

  /**
   * 格式化日期時間 YYYY-MM-DD HH:mm
   */
  formatDateTime(date) {
    if (!date) return "";
    const d = new Date(date);
    const year = d.getFullYear();
    const month = ("0" + (d.getMonth() + 1)).slice(-2);
    const day = ("0" + d.getDate()).slice(-2);
    const hours = ("0" + d.getHours()).slice(-2);
    const minutes = ("0" + d.getMinutes()).slice(-2);
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  }
};
