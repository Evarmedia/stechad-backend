const moment = require("moment");
const { Op } = require("sequelize");
const { Attendance } = require("../models");

const ATTENDANCE_CLOSE_HOUR = 23;
const ATTENDANCE_CLOSE_MINUTE = 59;
const DEFAULT_UTC_OFFSET_MINUTES = 60;

const getUtcOffsetMinutes = () => {
  const configuredOffset = process.env.ATTENDANCE_UTC_OFFSET_MINUTES === undefined
    ? Number.NaN
    : Number(process.env.ATTENDANCE_UTC_OFFSET_MINUTES);
  return Number.isFinite(configuredOffset) ? configuredOffset : DEFAULT_UTC_OFFSET_MINUTES;
};

const getWorkforceMoment = (value) => moment(value).utcOffset(getUtcOffsetMinutes());

const isAttendanceDayClosed = (value) => {
  const now = getWorkforceMoment(value);
  return now.hour() > ATTENDANCE_CLOSE_HOUR
    || (now.hour() === ATTENDANCE_CLOSE_HOUR && now.minute() >= ATTENDANCE_CLOSE_MINUTE);
};

const reconcileUnclosedAttendance = async (value) => {
  const now = getWorkforceMoment(value);
  const closedThrough = now.clone()
    .subtract(isAttendanceDayClosed(now) ? 0 : 1, "day")
    .format("YYYY-MM-DD");

  const [updatedCount] = await Attendance.update(
    { status: "absent" },
    {
      where: {
        clock_out: null,
        status: { [Op.ne]: "absent" },
        work_date: { [Op.lte]: closedThrough },
      },
    },
  );

  return updatedCount;
};

const scheduleNextAttendanceClose = () => {
  const now = getWorkforceMoment();
  const nextClose = now.clone()
    .startOf("day")
    .hour(ATTENDANCE_CLOSE_HOUR)
    .minute(ATTENDANCE_CLOSE_MINUTE)
    .second(0)
    .millisecond(0);

  if (!nextClose.isAfter(now)) nextClose.add(1, "day");

  return setTimeout(async () => {
    try {
      const updatedCount = await reconcileUnclosedAttendance();
      if (updatedCount) console.log(`Marked ${updatedCount} unclosed attendance record(s) absent`);
    } catch (error) {
      console.error("Failed to close unclocked attendance records:", error.message);
    } finally {
      scheduleNextAttendanceClose();
    }
  }, nextClose.valueOf() - Date.now());
};

const startAttendanceCloseScheduler = async () => {
  try {
    await reconcileUnclosedAttendance();
  } catch (error) {
    console.error("Failed to reconcile attendance records on startup:", error.message);
  }
  return scheduleNextAttendanceClose();
};

module.exports = {
  getWorkforceMoment,
  isAttendanceDayClosed,
  reconcileUnclosedAttendance,
  startAttendanceCloseScheduler,
};
