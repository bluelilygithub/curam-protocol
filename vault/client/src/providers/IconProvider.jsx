import React, { createContext, useContext, useMemo } from 'react';
import useSettingsStore from '../store/settingsStore';
import * as LucideIcons from 'lucide-react';
import { semanticMap } from './iconMap';



const IconContext = createContext(null);

export function IconProvider({ children }) {
  const iconPack = useSettingsStore((s) => s.iconPack);

  const getIcon = useMemo(() => {
    return (name, props = {}) => {
      const mapping = semanticMap[name];
      if (!mapping) return null;
      const lucideName = mapping.lucide;
      const Icon = LucideIcons[lucideName];
      if (!Icon) return null;
      return <Icon size={18} {...props} />;
    };
  }, [iconPack]);

  return (
    <IconContext.Provider value={getIcon}>
      {children}
    </IconContext.Provider>
  );
}

export function useIcon() {
  return useContext(IconContext);
}

export default IconProvider;
