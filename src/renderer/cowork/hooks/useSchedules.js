// Schedule CRUD wrappers — thin layer that calls the API then refreshes.
//
// Ported directly from anton-cowork's useSchedules hook.

import { useCallback } from 'react';
import {
  createSchedule,
  updateSchedule,
  deleteSchedule,
  pauseSchedule,
  resumeSchedule,
  runScheduleNow,
} from '../api';

export default function useSchedules(refreshSchedules, refreshData) {
  const handleCreateSchedule = useCallback(async (payload) => {
    await createSchedule(payload);
    await refreshSchedules();
  }, [refreshSchedules]);

  const handleUpdateSchedule = useCallback(async (id, payload) => {
    await updateSchedule(id, payload);
    await refreshSchedules();
  }, [refreshSchedules]);

  const handleDeleteSchedule = useCallback(async (id) => {
    await deleteSchedule(id);
    await refreshSchedules();
  }, [refreshSchedules]);

  const handlePauseSchedule = useCallback(async (id) => {
    await pauseSchedule(id);
    await refreshSchedules();
  }, [refreshSchedules]);

  const handleResumeSchedule = useCallback(async (id) => {
    await resumeSchedule(id);
    await refreshSchedules();
  }, [refreshSchedules]);

  const handleRunScheduleNow = useCallback(async (id) => {
    await runScheduleNow(id);
    await refreshSchedules();
    refreshData();
  }, [refreshSchedules, refreshData]);

  return {
    handleCreateSchedule,
    handleUpdateSchedule,
    handleDeleteSchedule,
    handlePauseSchedule,
    handleResumeSchedule,
    handleRunScheduleNow,
  };
}
