import { useEffect, useMemo, useState } from 'react';
import { api, messageOf } from '../services/api';
import { Empty, PageTitle } from '../components/UI';
import { useAuth } from '../context/AuthContext';

export default function Performance() {
  const { user } = useAuth();

  const [rows, setRows] = useState<any[]>([]);
  const [emps, setEmps] = useState<any[]>([]);
  const [target, setTarget] = useState('');
  const [msg, setMsg] = useState('');
  const [calculating, setCalculating] = useState(false);
  const [showPerformanceRules, setShowPerformanceRules] = useState(false);
  const [attendanceRows, setAttendanceRows] = useState<any[]>([]);
  const [leaveRows, setLeaveRows] = useState<any[]>([]);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [selectedAttendanceDate, setSelectedAttendanceDate] = useState<string | null>(null);
  const [deductionFilter, setDeductionFilter] = useState<'All' | 'Absent' | 'Half Day' | 'Partial' | 'Unpaid Leave'>('All');
  const [deductionEmployee, setDeductionEmployee] = useState<string>('');

  const now = new Date();

  const [selectedMonth, setSelectedMonth] = useState(
    now.getMonth() + 1
  );

  const [selectedYear, setSelectedYear] = useState(
    now.getFullYear()
  );

  const safeNumber = (value: any, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  const clampScore = (value: any) => {
    return Math.max(0, Math.min(100, safeNumber(value, 0)));
  };
  const formatMinutes = (value: any) => {
    const minutes = Number(value);
    return Number.isFinite(minutes)
      ? `${Math.max(0, minutes).toFixed(2)} min`
      : '0.00 min';
  };

  const loadAttendance = async () => {
    try {
      setAttendanceLoading(true);

      const [attendanceResponse, leaveResponse] = await Promise.all([
        api.get('/attendance', {
          params: {
            month: selectedMonth,
            year: selectedYear,
            employeeId:
              user?.role === 'EMPLOYEE'
                ? undefined
                : target || undefined,
            _ts: Date.now(),
          },
        }),
        api.get('/leave', {
          params: {
            _ts: Date.now(),
          },
        }),
      ]);

      setAttendanceRows(
        Array.isArray(attendanceResponse.data)
          ? attendanceResponse.data
          : attendanceResponse.data?.rows ||
            attendanceResponse.data?.attendance ||
            []
      );

      setLeaveRows(
        Array.isArray(leaveResponse.data)
          ? leaveResponse.data
          : leaveResponse.data?.rows || []
      );
    } catch (e) {
      setAttendanceRows([]);
      setLeaveRows([]);
      setMsg(messageOf(e));
    } finally {
      setAttendanceLoading(false);
    }
  };

  const load = async () => {
    try {
      const r = await api.get('/performance', {
        params: {
          month: selectedMonth,
          year: selectedYear,
          _ts: Date.now(),
        },
      });

      const data = r.data;
      setRows(
        Array.isArray(data)
          ? data
          : Array.isArray(data?.scores)
            ? data.scores
            : data?.employee_id
              ? [data]
              : []
      );
    } catch (e) {
      setMsg(messageOf(e));
      setRows([]);
    }
  };

  useEffect(() => {
    load();
    loadAttendance();

    if (user?.role !== 'EMPLOYEE') {
      api
        .get('/employees')
        .then((r) => {
          setEmps(Array.isArray(r.data) ? r.data : []);
        })
        .catch((e) => {
          setMsg(messageOf(e));
          setEmps([]);
        });
    }
  }, [selectedMonth, selectedYear, target]);

  async function calc(employeeId?: string) {
    try {
      setCalculating(true);
      setMsg('');

      const response = await api.post(
        '/performance/calculate',
        null,
        {
          params: {
            employeeId: employeeId || target || undefined,
            month: selectedMonth,
            year: selectedYear,
          },
        }
      );

      // Use the freshly calculated server response immediately
      // instead of waiting for a second GET /performance request.
      const calculated = response.data;

      if (Array.isArray(calculated?.scores)) {
        setRows(calculated.scores);
      } else if (calculated?.employee_id || calculated?.id) {
        setRows((previous) => {
          const incomingId = Number(calculated.employee_id);

          const existingIndex = previous.findIndex(
            (row) => Number(row.employee_id) === incomingId
          );

          if (existingIndex === -1) {
            return [calculated, ...previous];
          }

          const next = [...previous];
          next[existingIndex] = {
            ...next[existingIndex],
            ...calculated,
          };

          return next;
        });
      }

      // Re-read the list without cache after the calculation.
      await load();

      setMsg(
        'Performance recalculated successfully using task and attendance deductions.'
      );
    } catch (e) {
      setMsg(messageOf(e));
    } finally {
      setCalculating(false);
    }
  }

  async function calcAll() {
    try {
      setCalculating(true);
      setMsg('');

      const response = await api.post(
        '/performance/calculate',
        null,
        {
          params: {
            month: selectedMonth,
            year: selectedYear,
          },
        }
      );

      // Apply newly calculated rows directly.
      if (Array.isArray(response.data?.scores)) {
        setRows(response.data.scores);
      }

      // Refresh from the server using a cache-busting query.
      await load();

      setMsg(
        'Performance recalculated successfully for all accessible employees using task and attendance deductions.'
      );
    } catch (e) {
      setMsg(messageOf(e));
    } finally {
      setCalculating(false);
    }
  }

  const monthName = new Date(selectedYear, selectedMonth - 1, 1).toLocaleString('en-IN', {
    month: 'long',
    year: 'numeric',
  });

  const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate();
  const firstDayOfMonth = new Date(selectedYear, selectedMonth - 1, 1).getDay();

  const calendarDays = Array.from(
    { length: firstDayOfMonth + daysInMonth },
    (_, index) => (index < firstDayOfMonth ? null : index - firstDayOfMonth + 1)
  );

  const dateKey = (year: number, month: number, day: number) =>
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const shiftDate = (dateText: string, days: number) => {
    const [year, month, day] = dateText.split('-').map(Number);
    const d = new Date(Date.UTC(year, month - 1, day));
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  const isSundayDate = (date: string) => {
    const [year, month, day] = date.split('-').map(Number);
    return new Date(year, month - 1, day).getDay() === 0;
  };

  const isPastDate = (date: string) => {
    const todayKey = dateKey(
      now.getFullYear(),
      now.getMonth() + 1,
      now.getDate()
    );
    return date < todayKey;
  };

  const getAttendanceForDate = (date: string) =>
    attendanceRows.filter((item) => {
      const itemDate =
        item.work_date ||
        item.date ||
        item.attendance_date ||
        item.created_at;
      return String(itemDate).slice(0, 10) === date;
    });

  const getLeaveForDate = (date: string, employeeId?: string | number) =>
    leaveRows.filter((item) => {
      const requestStatus = String(item.status || '').toUpperCase();

      if (requestStatus === 'REJECTED' || requestStatus === 'CANCELLED') {
        return false;
      }

      const start = String(item.start_date || '').slice(0, 10);
      const end = String(item.end_date || '').slice(0, 10);

      if (!start || !end || !(start <= date && end >= date)) {
        return false;
      }

      const targetEmp =
        employeeId !== undefined
          ? employeeId
          : user?.role === 'EMPLOYEE'
            ? user.employeeId
            : target;

      if (
        targetEmp &&
        String(item.employee_id) !== String(targetEmp)
      ) {
        return false;
      }

      return true;
    });

  const attendanceStatus = (record: any) =>
    String(record?.status || 'NO RECORD').toUpperCase();

  const individualStatus = (date: string, record?: any) => {
    const empId = record?.employee_id || (user?.role === 'EMPLOYEE' ? user.employeeId : target);
    const dayLeaves = getLeaveForDate(date, empId);

    if (
      dayLeaves.some(
        (item) => String(item.status || '').toUpperCase() === 'APPROVED'
      )
    ) {
      return 'LEAVE';
    }

    const pendingLeave = dayLeaves.some(
      (item) => String(item.status || '').toUpperCase() === 'PENDING'
    );

    if (record) {
      const status = attendanceStatus(record);

      if (status === 'LEAVE') return 'LEAVE';
      if (status === 'ABSENT') return 'ABSENT';

      if (status === 'HALF DAY' || status === 'HALF_DAY' || record.checkout_missed) {
        return 'HALF DAY';
      }

      if (status === 'PRESENT' || status === 'LATE') {
        if (
          record.checkout_missed ||
          (record.check_in && !record.check_out && isPastDate(date))
        ) {
          return 'HALF DAY';
        }

        return 'PRESENT';
      }

      return status;
    }

    if (pendingLeave) return 'PENDING LEAVE';
    if (isSundayDate(date)) return 'WEEK OFF';
    if (isPastDate(date)) return 'ABSENT';

    return 'UPCOMING';
  };

  const statusClass = (status: string) => {
    switch (status) {
      case 'PRESENT':
        return 'border-green-300 bg-green-50 text-green-800 hover:bg-green-100';
      case 'ABSENT':
        return 'border-red-300 bg-red-50 text-red-800 hover:bg-red-100';
      case 'LEAVE':
        return 'border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100';
      case 'HALF DAY':
        return 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100';
      case 'PENDING LEAVE':
        return 'border-orange-300 bg-orange-50 text-orange-800 hover:bg-orange-100';
      case 'WEEK OFF':
        return 'border-slate-300 bg-slate-100 text-slate-600 hover:bg-slate-200';
      case 'UPCOMING':
        return 'border-slate-200 bg-white text-slate-400 hover:bg-slate-50';
      default:
        return 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50';
    }
  };

  const statusDot = (status: string) => {
    switch (status) {
      case 'PRESENT': return 'bg-green-500';
      case 'ABSENT': return 'bg-red-500';
      case 'LEAVE': return 'bg-blue-500';
      case 'HALF DAY': return 'bg-amber-500';
      case 'PENDING LEAVE': return 'bg-orange-500';
      case 'WEEK OFF': return 'bg-slate-400';
      default: return 'bg-slate-300';
    }
  };

  const selectedPerformanceRow = useMemo(() => {
    const selectedEmployeeId =
      user?.role === 'EMPLOYEE'
        ? user.employeeId
        : target;

    if (!selectedEmployeeId) return null;

    return (
      rows.find(
        (row) =>
          String(row.employee_id) ===
          String(selectedEmployeeId)
      ) || null
    );
  }, [rows, target, user?.role, user?.employeeId]);

  const performanceAttendanceDeduction = useMemo(() => {
    if (selectedPerformanceRow) {
      const daily = selectedPerformanceRow?.attendance_daily;

      const parsed =
        Array.isArray(daily)
          ? daily
          : typeof daily === 'string'
            ? (() => {
                try {
                  const value = JSON.parse(daily);
                  return Array.isArray(value) ? value : [];
                } catch {
                  return [];
                }
              })()
            : [];

      const sum = parsed.reduce(
        (acc: number, item: any) =>
          acc + safeNumber(item?.deduction_percentage, 0),
        0
      );
      return sum > 0 ? sum : safeNumber(selectedPerformanceRow?.attendance_deduction, 0);
    }

    if (rows.length > 0) {
      const total = rows.reduce(
        (sum, r) => sum + clampScore(r.attendance_deduction),
        0
      );
      return total / rows.length;
    }

    return 0;
  }, [selectedPerformanceRow, rows]);

  const getDailyPerformanceForDate = (date: string) => {
    const daily = selectedPerformanceRow?.attendance_daily;

    const parsed =
      Array.isArray(daily)
        ? daily
        : typeof daily === 'string'
          ? (() => {
              try {
                const value = JSON.parse(daily);
                return Array.isArray(value) ? value : [];
              } catch {
                return [];
              }
            })()
          : [];

    return (
      parsed.find(
        (item: any) =>
          String(item.work_date).slice(0, 10) === date
      ) || null
    );
  };

  const getCalendarDayData = (date: string) => {
    const records = getAttendanceForDate(date);
    const selectedEmployeeId =
      user?.role === 'EMPLOYEE' ? user.employeeId : target;

    const leaves = getLeaveForDate(date, selectedEmployeeId || undefined);
    const approvedLeaves = leaves.filter(
      (item) => String(item.status || '').toUpperCase() === 'APPROVED'
    );
    const pendingLeaves = leaves.filter(
      (item) => String(item.status || '').toUpperCase() === 'PENDING'
    );

    const scopedRecords = selectedEmployeeId
      ? records.filter(
          (item) =>
            String(item.employee_id) === String(selectedEmployeeId)
        )
      : records;

    if (selectedEmployeeId) {
      const record = scopedRecords[0];

      const status =
        approvedLeaves.length
          ? 'LEAVE'
          : pendingLeaves.length && !record
            ? 'PENDING LEAVE'
            : individualStatus(date, record);

      return {
        records: scopedRecords,
        leaves,
        approvedLeaves,
        pendingLeaves,
        status,
        countLabel: status,
        daily: getDailyPerformanceForDate(date),
      };
    }

    const statuses = scopedRecords.map((record) =>
      individualStatus(date, record)
    );

    // Also include employees on approved leave who don't have an attendance record
    const leaveRecordsEmployees = new Set(scopedRecords.map((r) => String(r.employee_id)));
    const unrecordedApprovedLeaves = approvedLeaves.filter(
      (l) => !leaveRecordsEmployees.has(String(l.employee_id))
    );
    for (let i = 0; i < unrecordedApprovedLeaves.length; i++) {
      statuses.push('LEAVE');
    }

    if (!statuses.length) {
      const status = pendingLeaves.length
        ? 'PENDING LEAVE'
        : individualStatus(date);

      return {
        records: scopedRecords,
        leaves,
        approvedLeaves,
        pendingLeaves,
        status,
        countLabel: status,
        daily: getDailyPerformanceForDate(date),
      };
    }

    const counts = statuses.reduce<Record<string, number>>(
      (acc, status) => {
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      },
      {}
    );

    const priority = [
      'LEAVE',
      'ABSENT',
      'HALF DAY',
      'PRESENT',
      'PENDING LEAVE',
    ];

    const dominantStatus =
      priority.find((status) => counts[status] > 0) ||
      statuses[0];

    const countLabel =
      Object.entries(counts)
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .map(([status, count]) => `${count} ${status.toLowerCase()}`)
        .join(' • ');

    return {
      records: scopedRecords,
      leaves,
      approvedLeaves,
      pendingLeaves,
      status: dominantStatus,
      countLabel,
      daily: getDailyPerformanceForDate(date),
    };
  };

  const formatClock = (value?: string | null) => {
    if (!value) return '—';

    const parsed = new Date(value);

    if (!Number.isFinite(parsed.getTime())) {
      return String(value);
    }

    return parsed.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatWorkedHours = (value: any) => {
    const hours = Number(value);

    if (!Number.isFinite(hours) || hours < 0) {
      return '—';
    }

    const minutes = Math.round(hours * 60);

    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  };

  const changeAttendanceMonth = (offset: number) => {
    const nextDate = new Date(
      selectedYear,
      selectedMonth - 1 + offset,
      1
    );

    setSelectedMonth(nextDate.getMonth() + 1);
    setSelectedYear(nextDate.getFullYear());
    setSelectedAttendanceDate(null);
  };

  const attendanceSummary = useMemo(() => {
    const selectedEmployeeId =
      user?.role === 'EMPLOYEE' ? user.employeeId : target;

    if (selectedEmployeeId) {
      let present = 0;
      let absent = 0;
      let leave = 0;
      let halfDay = 0;

      for (let day = 1; day <= daysInMonth; day++) {
        const date = dateKey(selectedYear, selectedMonth, day);
        const dayData = getCalendarDayData(date);
        if (dayData.status === 'PRESENT') {
          present += 1;
        } else if (dayData.status === 'ABSENT') {
          absent += 1;
        } else if (dayData.status === 'LEAVE') {
          leave += 1;
        } else if (dayData.status === 'HALF DAY') {
          halfDay += 1;
        }
      }

      return {
        present,
        absent,
        leave,
        halfDay,
      };
    }

    let present = 0;
    let absent = 0;
    let leave = 0;
    let halfDay = 0;

    for (const record of attendanceRows) {
      const status = attendanceStatus(record);
      const isCheckOutMissed =
        !!record.checkout_missed ||
        (!!record.check_in &&
          !record.check_out &&
          isPastDate(String(record.work_date || record.date || '').slice(0, 10)));

      if (
        status === 'HALF DAY' ||
        status === 'HALF_DAY' ||
        isCheckOutMissed
      ) {
        halfDay += 1;
      } else if (status === 'PRESENT' || status === 'LATE') {
        present += 1;
      } else if (status === 'ABSENT') {
        absent += 1;
      } else if (status === 'LEAVE') {
        leave += 1;
      }
    }

    // Count approved leave days for all accessible employees that might not be in attendanceRows
    for (const l of leaveRows) {
      if (String(l.status || '').toUpperCase() === 'APPROVED') {
        const start = String(l.start_date || '').slice(0, 10);
        const end = String(l.end_date || '').slice(0, 10);
        if (start && end) {
          let cur = start;
          while (cur <= end) {
            const [y, m] = cur.split('-').map(Number);
            if (y === selectedYear && m === selectedMonth && !isSundayDate(cur)) {
              const hasAttendance = attendanceRows.some(
                (a) =>
                  String(a.employee_id) === String(l.employee_id) &&
                  String(a.work_date || a.date).slice(0, 10) === cur
              );
              if (!hasAttendance) {
                leave += 1;
              }
            }
            cur = shiftDate(cur, 1);
          }
        }
      }
    }

    return {
      present,
      absent,
      leave,
      halfDay,
    };
  }, [attendanceRows, leaveRows, target, user?.role, user?.employeeId, daysInMonth, selectedYear, selectedMonth, rows]);

  const selectedDayData = selectedAttendanceDate
    ? getCalendarDayData(selectedAttendanceDate)
    : null;

  const orderedRows = useMemo(() => {
    if (!target) {
      return rows;
    }

    return [...rows].sort((a, b) => {
      const aSelected =
        String(a.employee_id) === String(target);

      const bSelected =
        String(b.employee_id) === String(target);

      if (aSelected && !bSelected) {
        return -1;
      }

      if (!aSelected && bSelected) {
        return 1;
      }

      return 0;
    });
  }, [rows, target]);

  const allDeductionItems = useMemo(() => {
    const itemsMap = new Map<string, {
      date: string;
      employee_id: number;
      employee_name: string;
      employee_code: string;
      status: string;
      normalized_category: 'Absent' | 'Half Day' | 'Partial' | 'Unpaid Leave';
      required_minutes: number;
      worked_minutes: number;
      missing_minutes: number;
      deduction_percentage: number;
      deduction_type: string;
      reason: string;
    }>();

    // 1. Process all daily entries from calculated performance scores (rows)
    for (const r of rows) {
      const daily = r.attendance_daily;
      const parsed = Array.isArray(daily)
        ? daily
        : typeof daily === 'string'
        ? (() => {
            try {
              return JSON.parse(daily) || [];
            } catch {
              return [];
            }
          })()
        : [];

      for (const day of parsed) {
        const missing = safeNumber(day.missing_minutes, 0);
        const deductionPct = safeNumber(day.deduction_percentage, 0);
        const worked = safeNumber(day.worked_minutes, 0);
        const required = safeNumber(day.required_minutes, 0);
        const dateStr = String(day.work_date || day.date).slice(0, 10);

        if (missing > 0 || deductionPct > 0) {
          const attRec = attendanceRows.find(
            (a) =>
              String(a.employee_id) === String(r.employee_id) &&
              String(a.work_date || a.date || a.attendance_date).slice(0, 10) === dateStr
          );

          const hasCheckIn = !!attRec?.check_in;
          const hasCheckOut = !!attRec?.check_out;
          const isCheckoutMissed =
            !!attRec?.checkout_missed ||
            (hasCheckIn && !hasCheckOut && isPastDate(dateStr));

          const statusUpper = String(day.status || '').toUpperCase();
          const isLeave = statusUpper === 'LEAVE' || !!day.leave_type;
          const isAbsent =
            statusUpper === 'ABSENT' ||
            statusUpper === 'NO_RECORD' ||
            (worked === 0 && missing >= required && !isLeave && !hasCheckIn);

          const isHalfDay =
            !isLeave &&
            !isAbsent &&
            (isCheckoutMissed ||
              ((statusUpper === 'HALF_DAY' || statusUpper === 'HALF DAY') && !hasCheckOut));

          let normalized_category: 'Absent' | 'Half Day' | 'Partial' | 'Unpaid Leave' = 'Partial';
          let displayStatus = 'Partial';
          let deductionType = 'Insufficient Hours';
          let reason = `Worked ${formatMinutes(worked)} out of required ${formatMinutes(required)}`;

          if (isLeave) {
            normalized_category = 'Unpaid Leave';
            displayStatus = day.leave_type ? `Leave (${day.leave_type})` : 'Leave';
            deductionType = 'Unpaid Leave';
            reason = day.leave_type ? `Approved ${day.leave_type} Leave` : 'Unpaid Leave day';
          } else if (isAbsent) {
            normalized_category = 'Absent';
            displayStatus = 'Absent';
            deductionType = 'Unpaid Absence';
            reason = 'Marked Absent / No check-in recorded';
          } else if (isHalfDay) {
            normalized_category = 'Half Day';
            displayStatus = 'Half Day';
            deductionType = 'Half Day';
            const halfWorked = worked > 0 ? worked : Math.round(required / 2);
            reason = `Half day • Checkout missing (credited ${formatMinutes(halfWorked)} of required ${formatMinutes(required)}, 50% deduction)`;
          }

          const key = `${r.employee_id}-${dateStr}`;
          itemsMap.set(key, {
            date: dateStr,
            employee_id: Number(r.employee_id),
            employee_name: r.employee_name || 'Employee',
            employee_code: r.employee_code || `#${r.employee_id}`,
            status: displayStatus,
            normalized_category,
            required_minutes: required,
            worked_minutes: isHalfDay && worked === 0 ? Math.round(required / 2) : worked,
            missing_minutes: isHalfDay && missing === 0 ? Math.round(required / 2) : missing,
            deduction_percentage: deductionPct > 0 ? deductionPct : (100 / 26) * 0.5,
            deduction_type: deductionType,
            reason,
          });
        }
      }
    }

    // 2. Process all records from attendanceRows (ensuring half-day and missed checkout logs are never omitted)
    for (const att of attendanceRows) {
      const dateStr = String(att.work_date || att.date || att.attendance_date).slice(0, 10);
      const empId = Number(att.employee_id);
      const key = `${empId}-${dateStr}`;

      const hasCheckIn = !!att.check_in;
      const hasCheckOut = !!att.check_out;
      const isCheckoutMissed =
        !!att.checkout_missed ||
        (hasCheckIn && !hasCheckOut && isPastDate(dateStr));
      const statusUpper = String(att.status || '').toUpperCase();
      const reqMinutes = safeNumber(att.required_work_minutes, safeNumber(att.required_work_hours, 8) * 60);

      const empName = att.employee_name || emps.find((e) => Number(e.id) === empId)?.first_name || 'Employee';
      const empCode = att.employee_code || emps.find((e) => Number(e.id) === empId)?.employee_code || `#${empId}`;

      if (isCheckoutMissed || (statusUpper === 'HALF_DAY' || statusUpper === 'HALF DAY')) {
        const worked = Math.round(reqMinutes / 2);
        const missing = reqMinutes - worked;
        const deductionPct = (missing / reqMinutes) * (100 / 26);

        itemsMap.set(key, {
          date: dateStr,
          employee_id: empId,
          employee_name: empName,
          employee_code: empCode,
          status: 'Half Day',
          normalized_category: 'Half Day',
          required_minutes: reqMinutes,
          worked_minutes: worked,
          missing_minutes: missing,
          deduction_percentage: deductionPct,
          deduction_type: 'Half Day',
          reason: `Half day • Checkout missing (credited ${formatMinutes(worked)} of required ${formatMinutes(reqMinutes)}, 50% deduction)`,
        });
      } else if (statusUpper === 'ABSENT' && !itemsMap.has(key)) {
        const deductionPct = 100 / 26;
        itemsMap.set(key, {
          date: dateStr,
          employee_id: empId,
          employee_name: empName,
          employee_code: empCode,
          status: 'Absent',
          normalized_category: 'Absent',
          required_minutes: reqMinutes,
          worked_minutes: 0,
          missing_minutes: reqMinutes,
          deduction_percentage: deductionPct,
          deduction_type: 'Unpaid Absence',
          reason: 'Marked Absent / No check-in recorded',
        });
      } else if (hasCheckIn && hasCheckOut && !itemsMap.has(key)) {
        const workedMinutes = safeNumber(att.worked_minutes, safeNumber(att.total_hours, 0) * 60);
        if (workedMinutes < reqMinutes) {
          const missing = reqMinutes - workedMinutes;
          const deductionPct = (missing / reqMinutes) * (100 / 26);
          itemsMap.set(key, {
            date: dateStr,
            employee_id: empId,
            employee_name: empName,
            employee_code: empCode,
            status: 'Partial',
            normalized_category: 'Partial',
            required_minutes: reqMinutes,
            worked_minutes: workedMinutes,
            missing_minutes: missing,
            deduction_percentage: deductionPct,
            deduction_type: 'Insufficient Hours',
            reason: `Worked ${formatMinutes(workedMinutes)} out of required ${formatMinutes(reqMinutes)}`,
          });
        }
      }
    }

    return Array.from(itemsMap.values()).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [rows, attendanceRows, emps]);

  const filteredDeductionItems = useMemo(() => {
    return allDeductionItems.filter((item) => {
      if (user?.role === 'EMPLOYEE') {
        if (String(item.employee_id) !== String(user.employeeId)) {
          return false;
        }
      } else {
        if (deductionEmployee && String(item.employee_id) !== String(deductionEmployee)) {
          return false;
        }
        if (!deductionEmployee && target && String(item.employee_id) !== String(target)) {
          return false;
        }
      }
      if (deductionFilter !== 'All' && item.normalized_category !== deductionFilter) {
        return false;
      }
      return true;
    });
  }, [allDeductionItems, deductionFilter, deductionEmployee, target, user?.role, user?.employeeId]);

  return (
    <>
      <PageTitle
        title="Performance Management"
        subtitle="Performance is calculated using task performance, attendance performance, and applicable deductions"
        action={
          user?.role === 'EMPLOYEE' ? (
            <button
              className="btn btn-accent"
              disabled={calculating}
              onClick={() => calc()}
            >
              {calculating
                ? 'Calculating...'
                : 'Recalculate My Score'}
            </button>
          ) : undefined
        }
      />

      {user?.role === 'EMPLOYEE' && (
        <div className="card mb-5 flex flex-wrap items-center gap-3 p-4">
          <label className="text-sm font-bold text-slate-700">
            Month
          </label>

          <select
            className="input max-w-[180px]"
            value={selectedMonth}
            onChange={(e) =>
              setSelectedMonth(Number(e.target.value))
            }
          >
            {[
              'January',
              'February',
              'March',
              'April',
              'May',
              'June',
              'July',
              'August',
              'September',
              'October',
              'November',
              'December',
            ].map((name, index) => (
              <option key={name} value={index + 1}>
                {name}
              </option>
            ))}
          </select>

          <label className="ml-2 text-sm font-bold text-slate-700">
            Year
          </label>

          <select
            className="input max-w-[120px]"
            value={selectedYear}
            onChange={(e) =>
              setSelectedYear(Number(e.target.value))
            }
          >
            {Array.from(
              { length: 6 },
              (_, index) => now.getFullYear() - index
            ).map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>
      )}

      {user?.role !== 'EMPLOYEE' && (
        <div className="card mb-5 flex flex-wrap items-center gap-3 p-4">
          <select
            className="input max-w-[180px]"
            value={selectedMonth}
            onChange={(e) =>
              setSelectedMonth(Number(e.target.value))
            }
          >
            {[
              'January',
              'February',
              'March',
              'April',
              'May',
              'June',
              'July',
              'August',
              'September',
              'October',
              'November',
              'December',
            ].map((name, index) => (
              <option key={name} value={index + 1}>
                {name}
              </option>
            ))}
          </select>

          <select
            className="input max-w-[120px]"
            value={selectedYear}
            onChange={(e) =>
              setSelectedYear(Number(e.target.value))
            }
          >
            {Array.from(
              { length: 6 },
              (_, index) => now.getFullYear() - index
            ).map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>

          <select
            className="input max-w-sm"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">
              All Accessible ({user?.role === 'TEAM_LEAD' ? 'Team Members & Me' : 'All Employees'})
            </option>

            {user?.employeeId && (
              <option value={String(user.employeeId)}>
                ⭐ [Me] My Own Performance ({user.name})
              </option>
            )}

            {emps
              .filter((e) => String(e.id) !== String(user?.employeeId))
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.first_name} {e.last_name} ({e.employee_code})
                </option>
              ))}
          </select>

          <button
            className="btn btn-primary"
            disabled={!target || calculating}
            onClick={() => calc()}
          >
            {calculating && target
              ? 'Calculating...'
              : 'Calculate Performance'}
          </button>

          <button
            className="btn btn-accent"
            disabled={calculating}
            onClick={calcAll}
          >
            {calculating && !target
              ? 'Calculating...'
              : 'Recalculate All'}
          </button>
        </div>
      )}

      {msg && (
        <div className="mb-4 rounded-lg bg-white p-3 text-sm">
          {msg}
        </div>
      )}

      {orderedRows.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {orderedRows.map((r) => {
            const isSelected =
              user?.role !== 'EMPLOYEE' &&
              target !== '' &&
              String(r.employee_id) === String(target);

            // All six displayed performance values are calculated by the backend.
            const taskPerformance = clampScore(
              r.task_performance
            );

            const attendancePerformance = clampScore(
              r.attendance_performance
            );

            const taskDeduction = clampScore(
              r.task_deduction ??
                (100 - safeNumber(r.task_performance, 0))
            );

            const attendanceDeduction = clampScore(
              r.attendance_deduction
            );

            const totalDeduction = clampScore(
              r.total_deduction
            );

            const score = clampScore(
              r.final_payable
            );

            const metrics = [
              ['Task performance', taskPerformance],
              ['Attendance performance', attendancePerformance],
              ['Task deduction', taskDeduction],
              ['Attendance deduction', attendanceDeduction],
              ['Total deduction', totalDeduction],
              ['Final performance', score],
            ];return (
              <div
                key={r.id}
                className={
                  isSelected
                    ? `
                      card
                      relative
                      z-50
                      -translate-y-3
                      !border-2
                      !border-cyan-500
                      !border-solid
                      bg-cyan-50
                      shadow-[0_0_0_1px_rgba(6,182,212,0.20),0_18px_40px_rgba(6,182,212,0.22)]
                      transition-all
                      duration-300
                      p-5
                    `
                    : `
                      card
                      relative
                      z-0
                      translate-y-0
                      !border
                      !border-black
                      !border-solid
                      bg-white
                      text-black
                      shadow-none
                      transition-all
                      duration-300
                      p-5
                    `
                }
              >
                {isSelected && (
                  <div className="absolute left-5 top-5">
                    <span className="rounded-full bg-cyan-500 px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-sm">
                      Selected
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between gap-4">
                  <div
                    className={
                      isSelected ? 'pt-8' : ''
                    }
                  >
                    <h3 className="font-extrabold text-black">
                      {r.employee_name || user?.name}
                    </h3>

                    <div
                      className={
                        isSelected
                          ? 'mt-1 text-xs text-cyan-700'
                          : 'mt-1 text-xs text-black'
                      }
                    >
                      Final performance
                    </div>
                  </div>

                  <div
                    className={
                      isSelected
                        ? `
                          grid
                          h-24
                          w-24
                          shrink-0
                          place-items-center
                          rounded-full
                          border-4
                          border-cyan-500
                          bg-white
                          text-lg
                          font-extrabold
                          text-cyan-600
                          shadow-sm
                        `
                        : `
                          grid
                          h-24
                          w-24
                          shrink-0
                          place-items-center
                          rounded-full
                          border-4
                          border-black
                          bg-white
                          text-lg
                          font-extrabold
                          text-black
                          shadow-none
                        `
                    }
                  >
                    {score.toFixed(2)}%
                  </div>
                </div>

                <div className="mt-5 space-y-2 text-sm">
                  {metrics.map(([key, value]) => (
                    <div
                      className={
                        isSelected
                          ? 'flex justify-between border-b border-cyan-100 pb-2 last:border-b-0'
                          : 'flex justify-between border-b border-slate-200 pb-2 last:border-b-0'
                      }
                      key={String(key)}
                    >
                      <span
                        className={
                          isSelected
                            ? 'text-slate-700'
                            : 'text-black'
                        }
                      >
                        {key}
                      </span>

                      <b
                        className={
                          isSelected
                            ? 'text-cyan-700'
                            : 'text-black'
                        }
                      >
                        {clampScore(value).toFixed(2)}%
                      </b>
                    </div>
                  ))}
                </div>              </div>
            );
          })}
        </div>
      ) : (
        <Empty>No performance scores calculated yet.</Empty>
      )}



      <div className="card mt-10 mb-5 overflow-hidden p-0">
        <div className="border-b border-slate-200 bg-gradient-to-r from-white via-slate-50 to-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-extrabold text-black">
                Attendance Calendar
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Actual attendance and leave data for each date. Click a day
                for the full record, working hours, leave details and status.
              </p>

              {user?.role !== 'EMPLOYEE' && (
                <div className="mt-2 inline-flex rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-bold text-cyan-800">
                  Calendar scope:{' '}
                  {target
                    ? emps.find(
                        (employee) =>
                          String(employee.id) === String(target)
                      )?.employee_code || 'Selected employee'
                    : 'All employees'}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => changeAttendanceMonth(-1)}
              >
                ← Previous
              </button>

              <div className="min-w-[180px] rounded-xl border border-slate-200 bg-white px-4 py-2 text-center font-extrabold text-black shadow-sm">
                {monthName}
              </div>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => changeAttendanceMonth(1)}
              >
                Next →
              </button>
            </div>
          </div>
        </div>

        <div className="p-5">
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {[
              ['Present', attendanceSummary.present, 'bg-green-50 border-green-200 text-green-800'],
              ['Absent', attendanceSummary.absent, 'bg-red-50 border-red-200 text-red-800'],
              ['Leave', attendanceSummary.leave, 'bg-blue-50 border-blue-200 text-blue-800'],
              ['Half Day', attendanceSummary.halfDay, 'bg-amber-50 border-amber-200 text-amber-800'],
              [
                selectedPerformanceRow ? 'Deduction' : 'Avg Deduction',
                `${performanceAttendanceDeduction.toFixed(2)}%`,
                'bg-slate-50 border-slate-200 text-slate-800',
              ],
            ].map(([label, value, color]) => (
              <div
                key={String(label)}
                className={`rounded-xl border p-3 ${color}`}
              >
                <div className="text-xs font-bold opacity-75">
                  {label}
                </div>
                <div className="mt-1 text-xl font-extrabold">
                  {value}
                </div>
              </div>
            ))}
          </div>

          <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-700">
            {[
              ['PRESENT', 'Present'],
              ['LEAVE', 'Leave'],
              ['HALF DAY', 'Half Day'],
              ['ABSENT', 'Absent'],
              ['PENDING LEAVE', 'Pending Leave'],
              ['WEEK OFF', 'Week Off'],
              ['UPCOMING', 'Upcoming'],
            ].map(([status, label]) => (
              <span
                key={status}
                className="inline-flex items-center gap-2"
              >
                <span
                  className={`h-2.5 w-2.5 rounded-full ${statusDot(status)}`}
                />
                {label}
              </span>
            ))}
          </div>

          <div className="mb-3 grid grid-cols-7 gap-2 text-center text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(
              (day) => (
                <div key={day} className="py-1">
                  {day}
                </div>
              )
            )}
          </div>

          {attendanceLoading ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 py-12 text-center text-sm font-semibold text-slate-500">
              Loading actual attendance and leave data...
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-2">
              {calendarDays.map((day, index) => {
                if (!day) {
                  return (
                    <div
                      key={`empty-${index}`}
                      className="min-h-[112px]"
                    />
                  );
                }

                const date = dateKey(
                  selectedYear,
                  selectedMonth,
                  day
                );
                const data = getCalendarDayData(date);
                const isSelected =
                  selectedAttendanceDate === date;

                const isToday =
                  date ===
                  dateKey(
                    now.getFullYear(),
                    now.getMonth() + 1,
                    now.getDate()
                  );

                return (
                  <button
                    type="button"
                    key={date}
                    onClick={() =>
                      setSelectedAttendanceDate(date)
                    }
                    title={`${date} • ${data.countLabel}`}
                    className={`group relative min-h-[112px] rounded-xl border p-2.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md ${statusClass(
                      data.status
                    )} ${
                      isSelected
                        ? 'ring-2 ring-cyan-500 ring-offset-2 shadow-md'
                        : ''
                    }`}
                  >
                    {isToday && (
                      <span className="absolute right-2 top-2 rounded-full bg-cyan-600 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-white">
                        Today
                      </span>
                    )}

                    <div className="flex items-center gap-2">
                      <span className="text-lg font-extrabold">
                        {day}
                      </span>
                      <span
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDot(
                          data.status
                        )}`}
                      />
                    </div>

                    <div className="mt-2 text-[11px] font-extrabold uppercase tracking-wide">
                      {data.status}
                    </div>

                    <div className="mt-1 line-clamp-2 text-[10px] font-semibold opacity-80">
                      {data.countLabel}
                    </div>

                    {selectedPerformanceRow &&
                      data.daily && (
                        <div className="mt-2 rounded-md bg-white/60 px-2 py-1 text-[10px] font-extrabold">
                          {clampScore(
                            data.daily.attendance_percentage
                          ).toFixed(2)}% attendance
                          <span className="mx-1 opacity-50">•</span>
                          {safeNumber(
                            data.daily.deduction_percentage
                          ).toFixed(2)}% deduction
                        </div>
                      )}

                    {data.records.length === 1 && (
                      <div className="mt-2 text-[10px] font-semibold opacity-80">
                        {formatClock(data.records[0].check_in)}
                        {' → '}
                        {data.records[0].check_out
                          ? formatClock(data.records[0].check_out)
                          : data.records[0].checkout_missed
                            ? 'Missed'
                            : '—'}
                      </div>
                    )}

                    {data.records.length > 1 && (
                      <div className="mt-2 text-[10px] font-extrabold opacity-80">
                        {data.records.length} employee records
                      </div>
                    )}

                    {data.approvedLeaves.length > 0 && (
                      <div className="mt-1 text-[10px] font-extrabold">
                        Leave:{' '}
                        {String(
                          data.approvedLeaves[0].leave_type ||
                            'APPROVED'
                        ).toUpperCase()}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {selectedAttendanceDate && selectedDayData && (
            <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4">
                <div>
                  <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-500">
                    Selected Date
                  </div>

                  <h3 className="mt-1 text-xl font-extrabold text-black">
                    {new Date(
                      `${selectedAttendanceDate}T00:00:00`
                    ).toLocaleDateString('en-IN', {
                      weekday: 'long',
                      day: '2-digit',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </h3>

                  <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-extrabold text-slate-700">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${statusDot(
                        selectedDayData.status
                      )}`}
                    />
                    {selectedDayData.status}
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() =>
                    setSelectedAttendanceDate(null)
                  }
                >
                  Close
                </button>
              </div>

              <div className="grid gap-4 p-5 xl:grid-cols-[1fr_1.6fr]">
                <div className="space-y-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                      Day Summary
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div className="rounded-lg bg-white p-3">
                        <div className="text-[11px] font-bold text-slate-500">
                          Attendance Records
                        </div>
                        <div className="mt-1 text-xl font-extrabold text-black">
                          {selectedDayData.records.length}
                        </div>
                      </div>

                      <div className="rounded-lg bg-white p-3">
                        <div className="text-[11px] font-bold text-slate-500">
                          Leave Requests
                        </div>
                        <div className="mt-1 text-xl font-extrabold text-black">
                          {selectedDayData.leaves.length}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 rounded-lg bg-white p-3 text-sm font-semibold text-slate-700">
                      {selectedDayData.countLabel}
                    </div>
                  </div>

                  {selectedDayData.daily && (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                      <div className="text-xs font-extrabold uppercase tracking-wide text-emerald-700">
                        Backend Attendance Calculation
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <div className="rounded-lg bg-white/70 p-3">
                          <div className="text-[10px] font-extrabold uppercase text-emerald-700">
                            Required
                          </div>
                          <div className="mt-1 text-sm font-extrabold text-emerald-950">
                            {formatMinutes(
                              selectedDayData.daily.required_minutes
                            )}
                          </div>
                        </div>

                        <div className="rounded-lg bg-white/70 p-3">
                          <div className="text-[10px] font-extrabold uppercase text-emerald-700">
                            Worked
                          </div>
                          <div className="mt-1 text-sm font-extrabold text-emerald-950">
                            {formatMinutes(
                              selectedDayData.daily.worked_minutes
                            )}
                          </div>
                        </div>

                        <div className="rounded-lg bg-white/70 p-3">
                          <div className="text-[10px] font-extrabold uppercase text-emerald-700">
                            Missing
                          </div>
                          <div className="mt-1 text-sm font-extrabold text-emerald-950">
                            {formatMinutes(
                              selectedDayData.daily.missing_minutes
                            )}
                          </div>
                        </div>

                        <div className="rounded-lg border border-emerald-200 bg-white/80 p-3">
                          <div className="text-[10px] font-extrabold uppercase text-emerald-700">
                            Attendance %
                          </div>
                          <div className="mt-1 text-xl font-extrabold text-emerald-950">
                            {clampScore(
                              selectedDayData.daily.attendance_percentage
                            ).toFixed(2)}%
                          </div>
                        </div>

                        <div className="rounded-lg border border-emerald-200 bg-white/80 p-3">
                          <div className="text-[10px] font-extrabold uppercase text-emerald-700">
                            Daily Deduction
                          </div>
                          <div className="mt-1 text-xl font-extrabold text-emerald-950">
                            {safeNumber(
                              selectedDayData.daily.deduction_percentage
                            ).toFixed(2)}%
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {selectedDayData.approvedLeaves.length > 0 && (
                    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                      <div className="text-xs font-extrabold uppercase tracking-wide text-blue-700">
                        Approved Leave
                      </div>

                      <div className="mt-3 space-y-3">
                        {selectedDayData.approvedLeaves.map(
                          (leave) => (
                            <div
                              key={`approved-${leave.id}`}
                              className="rounded-lg border border-blue-200 bg-white/70 p-3"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-extrabold text-blue-900">
                                  {String(
                                    leave.leave_type ||
                                      'APPROVED'
                                  ).toUpperCase()}
                                </span>

                                {leave.employee_name &&
                                  !target &&
                                  user?.role !== 'EMPLOYEE' && (
                                    <span className="text-xs font-bold text-blue-700">
                                      {leave.employee_name}
                                    </span>
                                  )}
                              </div>

                              <div className="mt-2 text-sm text-blue-900">
                                {leave.reason ||
                                  'No reason provided'}
                              </div>

                              <div className="mt-2 text-xs font-semibold text-blue-700">
                                {String(
                                  leave.start_date
                                ).slice(0, 10)}
                                {' → '}
                                {String(
                                  leave.end_date
                                ).slice(0, 10)}
                              </div>

                              {leave.reference_link && (
                                <div className="mt-2 break-all text-xs font-semibold text-blue-700">
                                  Reference: {leave.reference_link}
                                </div>
                              )}
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )}

                  {selectedDayData.pendingLeaves.length > 0 && (
                    <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
                      <div className="text-xs font-extrabold uppercase tracking-wide text-orange-700">
                        Pending Leave Requests
                      </div>

                      <div className="mt-3 space-y-2">
                        {selectedDayData.pendingLeaves.map(
                          (leave) => (
                            <div
                              key={`pending-${leave.id}`}
                              className="rounded-lg border border-orange-200 bg-white/70 px-3 py-2 text-sm"
                            >
                              <div className="font-extrabold text-orange-900">
                                {String(
                                  leave.leave_type ||
                                    'LEAVE'
                                ).toUpperCase()}
                              </div>

                              <div className="mt-1 text-orange-900">
                                {leave.reason ||
                                  'No reason provided'}
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  {selectedDayData.records.length > 0 ? (
                    <div className="space-y-3">
                      <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                        Actual Attendance Data
                      </div>

                      {selectedDayData.records.map(
                        (record) => (
                          <div
                            key={`attendance-${record.id}`}
                            className={`rounded-xl border p-4 ${statusClass(
                              individualStatus(
                                selectedAttendanceDate,
                                record
                              )
                            )}`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-extrabold">
                                  {record.employee_name ||
                                    user?.name ||
                                    'Employee'}
                                </div>

                                {record.employee_code && (
                                  <div className="mt-0.5 text-xs font-semibold opacity-75">
                                    {record.employee_code}
                                    {record.department_name
                                      ? ` • ${record.department_name}`
                                      : ''}
                                  </div>
                                )}
                              </div>

                              <span className="rounded-full border border-current/20 bg-white/60 px-3 py-1 text-[10px] font-extrabold uppercase">
                                {individualStatus(
                                  selectedAttendanceDate,
                                  record
                                )}
                              </span>
                            </div>

                            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                              <div>
                                <div className="text-[10px] font-extrabold uppercase opacity-65">
                                  Check-in
                                </div>
                                <div className="mt-1 text-sm font-extrabold">
                                  {formatClock(record.check_in)}
                                </div>
                              </div>

                              <div>
                                <div className="text-[10px] font-extrabold uppercase opacity-65">
                                  Check-out
                                </div>
                                <div className="mt-1 text-sm font-extrabold">
                                  {record.check_out
                                    ? formatClock(record.check_out)
                                    : record.checkout_missed
                                      ? 'Missed'
                                      : '—'}
                                </div>
                              </div>

                              <div>
                                <div className="text-[10px] font-extrabold uppercase opacity-65">
                                  Worked
                                </div>
                                <div className="mt-1 text-sm font-extrabold">
                                  {formatWorkedHours(
                                    record.worked_hours
                                  )}
                                </div>
                              </div>

                              <div>
                                <div className="text-[10px] font-extrabold uppercase opacity-65">
                                  Required
                                </div>
                                <div className="mt-1 text-sm font-extrabold">
                                  {formatWorkedHours(
                                    record.required_work_hours
                                  )}
                                </div>
                              </div>

                              <div>
                                <div className="text-[10px] font-extrabold uppercase opacity-65">
                                  Mode
                                </div>
                                <div className="mt-1 text-sm font-extrabold">
                                  {record.attendance_mode || '—'}
                                </div>
                              </div>

                              <div>
                                <div className="text-[10px] font-extrabold uppercase opacity-65">
                                  Location
                                </div>
                                <div className="mt-1 break-words text-sm font-semibold">
                                  {record.location_text || '—'}
                                </div>
                              </div>
                            </div>

                            {record.attendance_note && (
                              <div className="mt-4 rounded-lg border border-current/10 bg-white/50 px-3 py-2 text-xs font-bold">
                                {record.attendance_note}
                              </div>
                            )}
                          </div>
                        )
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
                      <div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                        Attendance
                      </div>

                      <p className="mt-2 text-sm font-semibold text-slate-600">
                        {selectedDayData.status === 'WEEK OFF'
                          ? 'Sunday / week off. No attendance is expected.'
                          : selectedDayData.status === 'UPCOMING'
                            ? 'No attendance record yet for this upcoming date.'
                            : selectedDayData.status === 'PENDING LEAVE'
                              ? 'There is a pending leave request for this date. It does not count as approved leave yet.'
                              : selectedDayData.approvedLeaves.length > 0
                                ? 'This date is covered by approved leave.'
                                : 'No attendance record is available for this date.'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Attendance Deductions Breakdown Section */}
      <div className="card mt-10 mb-5 overflow-hidden p-0">
        <div className="border-b border-slate-200 bg-gradient-to-r from-white via-rose-50/40 to-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-extrabold text-black">
                Attendance Deductions Breakdown
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Detailed record of all attendance deductions (Absence, Half Day, Missing Hours, Unpaid Leave) for {monthName}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {user?.role !== 'EMPLOYEE' && (
                <div className="flex items-center gap-2">
                  <label className="text-xs font-bold text-slate-600">Employee:</label>
                  <select
                    className="input !py-1.5 !px-3 text-xs font-bold max-w-[200px]"
                    value={deductionEmployee || target}
                    onChange={(e) => setDeductionEmployee(e.target.value)}
                  >
                    <option value="">All Accessible</option>
                    {emps.map((e) => (
                      <option key={e.id} value={String(e.id)}>
                        {e.first_name} {e.last_name} ({e.employee_code})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-slate-600">Type:</label>
                <select
                  className="input !py-1.5 !px-3 text-xs font-bold"
                  value={deductionFilter}
                  onChange={(e) => setDeductionFilter(e.target.value as any)}
                >
                  <option value="All">All Deductions</option>
                  <option value="Absent">Absent</option>
                  <option value="Half Day">Half Day</option>
                  <option value="Partial">Partial</option>
                  <option value="Unpaid Leave">Unpaid Leave</option>
                </select>
              </div>
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-extrabold text-rose-800 shadow-sm">
                Total Items: {filteredDeductionItems.length}
              </div>
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-extrabold text-red-800 shadow-sm">
                Total Deduction: {filteredDeductionItems.reduce((sum, item) => sum + item.deduction_percentage, 0).toFixed(2)}%
              </div>
            </div>
          </div>
        </div>

        <div className="p-5">
          {filteredDeductionItems.length > 0 ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    {user?.role !== 'EMPLOYEE' && <th>Employee</th>}
                    <th>Attendance Status</th>
                    <th>Required</th>
                    <th>Worked</th>
                    <th>Missing</th>
                    <th>Deduction Type</th>
                    <th>Deduction %</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDeductionItems.map((item, idx) => (
                    <tr key={`${item.employee_id}-${item.date}-${idx}`}>
                      <td className="font-bold">{item.date}</td>
                      {user?.role !== 'EMPLOYEE' && (
                        <td>
                          <b>{item.employee_name}</b>
                          <div className="text-xs muted">{item.employee_code}</div>
                        </td>
                      )}
                      <td>
                        <span
                          className={`badge font-extrabold ${
                            item.normalized_category === 'Absent'
                              ? 'border border-red-200 bg-red-50 text-red-700'
                              : item.normalized_category === 'Half Day'
                              ? 'border border-amber-200 bg-amber-50 text-amber-800'
                              : item.normalized_category === 'Unpaid Leave'
                              ? 'border border-blue-200 bg-blue-50 text-blue-700'
                              : 'border border-orange-200 bg-orange-50 text-orange-800'
                          }`}
                        >
                          {item.status}
                        </span>
                      </td>
                      <td>{formatMinutes(item.required_minutes)}</td>
                      <td>{formatMinutes(item.worked_minutes)}</td>
                      <td className="font-extrabold text-red-600">
                        {formatMinutes(item.missing_minutes)}
                      </td>
                      <td>
                        <span className="badge border border-amber-200 bg-amber-50 text-amber-800 font-bold">
                          {item.deduction_type}
                        </span>
                      </td>
                      <td className="font-extrabold text-red-700 text-sm">
                        {item.deduction_percentage.toFixed(2)}%
                      </td>
                      <td className="text-xs text-slate-600 max-w-xs">{item.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-6 text-center text-slate-500 font-semibold bg-slate-50 rounded-xl border border-slate-200">
              No attendance deductions matching "{deductionFilter}" recorded for this period.
            </div>
          )}
        </div>
      </div>
    </>
  );
}