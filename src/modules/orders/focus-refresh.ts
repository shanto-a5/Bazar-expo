import * as React from 'react';
import { useFocusEffect } from 'expo-router';

export function useFocusRefresh(): () => void {
  const [, setTick] = React.useState(0);

  useFocusEffect(
    React.useCallback(() => {
      setTick((t) => t + 1);
    }, []),
  );

  return () => setTick((t) => t + 1);
}
