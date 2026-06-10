import React, { createContext, useContext, useMemo } from 'react';
import {
  createMissionControlPluginClient,
  type ConnectionMode,
  type MissionControlPluginClient,
} from '@flanksource/plugin-ui-sdk';

type MissionControlProviderProps = {
  mode: ConnectionMode;
  baseUrl: string;
  children: React.ReactNode;
};

const MissionControlContext = createContext<MissionControlPluginClient | null>(null);

export function MissionControlProvider({ mode, baseUrl, children }: MissionControlProviderProps) {
  const client = useMemo(
    () => createMissionControlPluginClient({ mode, baseUrl }),
    [mode, baseUrl],
  );

  return (
    <MissionControlContext.Provider value={client}>
      {children}
    </MissionControlContext.Provider>
  );
}

export function useMissionControl(): MissionControlPluginClient {
  const client = useContext(MissionControlContext);
  if (!client) {
    throw new Error('useMissionControl must be used inside MissionControlProvider');
  }
  return client;
}
