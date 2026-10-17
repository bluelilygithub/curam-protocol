import { useIcon } from '../../../providers/IconProvider';
import IconLibraryGenerator from '../../../components/IconLibraryGenerator';
import React from 'react';

export default function IconLibraryTool({ active }) {
  const getIcon = useIcon();



  return (
    <>
      <IconLibraryGenerator getIcon={getIcon} />
    </>
  );
}
