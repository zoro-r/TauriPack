import request from './request';

type OrangeLoginStatus = 'browser' | 'scan-required' | 'signed-in';
type AuthBridge = {
  getContext(): Promise<{ chaobenLogin?: boolean }>;
  chaobenTicket?(): Promise<{ ticket: string }>;
};
let opening: Promise<OrangeLoginStatus> | undefined;
let lastResult: Promise<OrangeLoginStatus> | undefined;

const getAuthBridge = () => (window as Window & { orangeApp?: { auth?: AuthBridge } }).orangeApp?.auth;
export const hasOrangeLoginBridge = () => Boolean(getAuthBridge()?.chaobenTicket);

async function openFromClient(): Promise<OrangeLoginStatus> {
  const auth = getAuthBridge();
  if (!auth?.chaobenTicket || !(await auth.getContext()).chaobenLogin) return 'browser';
  const { ticket } = await auth.chaobenTicket();
  const result = await request<{ status: 'scan-required' | 'signed-in' }>('/api/auth/orange/session', {
    method: 'POST',
    data: { ticket },
    alert: false
  });
  return result.status;
}

export function openOrangeLogin(retry = false) {
  if (opening) return opening;
  if (!lastResult || retry) {
    lastResult = opening = openFromClient();
    const finish = () => { opening = undefined; };
    void opening.then(finish, finish);
  }
  return lastResult;
}

export function getWechatLoginQr<T>(bindOrange: boolean) {
  return request<T>('/api/auth/wechat/qr', {
    ...(bindOrange && { params: { bindOrange: '1' } }),
    alert: false
  });
}

export function completeWechatLogin(loginCode: string, bindOrange: boolean) {
  return request('/api/auth/token', {
    method: 'POST',
    data: { loginCode, ...(bindOrange && { bindOrange: true }) },
    alert: false
  });
}
