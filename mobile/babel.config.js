module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Reanimated 4 moved its worklet transform into react-native-worklets.
      // It has to be last, and without it every animation silently runs on the
      // JS thread instead of the UI thread — which is exactly the stutter this
      // app is meant not to have.
      'react-native-worklets/plugin',
    ],
  };
};
