// Leap year 2000 is only a storage anchor for the existing DATEONLY columns.
// Birth years are never collected or serialized.
const normalizeBirthday = (value) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^(?:\d{4}-)?\d{2}-\d{2}$/.test(value)) {
    throw new Error("Birthday must use MM-DD format");
  }
  const monthDay = value.slice(-5);
  const [month, day] = monthDay.split("-").map(Number);
  const date = new Date(Date.UTC(2000, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error("Birthday must be a valid month and day");
  }
  return monthDay;
};

const birthdayAttribute = (DataTypes) => ({
  type: DataTypes.DATEONLY,
  allowNull: true,
  get() { return normalizeBirthday(this.getDataValue("date_of_birth")); },
  set(value) {
    const monthDay = normalizeBirthday(value);
    this.setDataValue("date_of_birth", monthDay ? `2000-${monthDay}` : null);
  },
});

module.exports = { normalizeBirthday, birthdayAttribute };
