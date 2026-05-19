const getRequiredEnv = (key: string) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing env: ${key}`);
  }
  return value;
};

export const buildWechatOauthUrl = (state: string) => {
  const appId = getRequiredEnv('WECHAT_APPID');
  const redirectUri = encodeURIComponent(getRequiredEnv('WECHAT_REDIRECT_URL'));
  return `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${appId}&redirect_uri=${redirectUri}&response_type=code&scope=snsapi_userinfo&state=${state}#wechat_redirect`;
};
