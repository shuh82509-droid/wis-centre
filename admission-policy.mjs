// Owner-confirmed departures. Historical grants and tasks remain untouched.
const confirmedDepartures = new Set(['OD-005620', 'FD-028611', 'OD-006169']);
export function staffNumber(user = {}) {
  for (const field of ['number', 'user_number', 'userNumber', 'employeeId', 'userId', 'id', 'username', 'identifier']) {
    if (typeof user[field] !== 'string') continue;
    const match = user[field].trim().toUpperCase().replace(/^NUMBER:/, '').match(/^([A-Z]{2})-?(\d{3,8})$/);
    if (match) return `${match[1]}-${match[2]}`;
  }
  return '';
}
export function enforceConfirmedAdmission(response) {
  if (response?.status !== 200 || !confirmedDepartures.has(staffNumber(response.payload?.user))) return response;
  return {status: 403, payload: {code: 'CONFIRMED_DEPARTURE', detail: '该成员已确认离职，不能进入中枢或业务工作台'}};
}
