let io;
const setRealtime = (value) => { io = value; };
const afterCommit = (transaction, callback) => {
  const safe = async () => { try { await callback(); } catch (error) { console.error("Realtime delivery failed:", error.message); } };
  if (transaction) transaction.afterCommit(safe);
  else return safe();
};
const emitUser = (id, event, payload = {}) => io?.to(`user_${id}`).emit(event, payload);
const disconnectUser = (id) => io?.in(`user_${id}`).disconnectSockets(true);
module.exports = { setRealtime, afterCommit, emitUser, disconnectUser };
