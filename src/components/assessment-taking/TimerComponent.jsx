import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Clock, AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'react-hot-toast';

const TimerComponent = forwardRef(({ 
  duration, 
  onTimeUp, 
  className = '', 
  submissionId = null
}, ref) => {
  const [timeRemaining, setTimeRemaining] = useState(duration || 0);
  const [syncStatus, setSyncStatus] = useState('synced'); // 'synced', 'syncing', 'error'
  const [isInitialized, setIsInitialized] = useState(false);
  
  const intervalRef = useRef(null);
  const syncIntervalRef = useRef(null);
  const onTimeUpRef = useRef(onTimeUp);
  
  // Update ref when callback changes
  useEffect(() => {
    onTimeUpRef.current = onTimeUp;
  }, [onTimeUp]);

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    getTimeRemaining: () => timeRemaining,
    reset: (newDuration) => {
      if (newDuration && newDuration > 0) {
        setTimeRemaining(newDuration);
        setIsInitialized(true);
      }
    }
  }));

  // Fetch time remaining from server
  const fetchServerTime = async () => {
    if (!submissionId) return null;
    
    try {
      setSyncStatus('syncing');
      const token = localStorage.getItem('token') || localStorage.getItem('lmsToken');
      const { getApiBaseUrl } = await import('../../utils/apiConfig');
      const apiBaseUrl = getApiBaseUrl();
      
      const response = await fetch(`${apiBaseUrl}/student-assessments/${submissionId}/time-remaining`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data && data.data.remainingSeconds !== undefined) {
          setSyncStatus('synced');
          return data.data.remainingSeconds;
        }
      }
      setSyncStatus('error');
      return null;
    } catch (error) {
      console.error('Error fetching server time:', error);
      setSyncStatus('error');
      return null;
    }
  };

  // Initialize timer from server
  useEffect(() => {
    if (!submissionId || isInitialized) return;
    
    const initializeTimer = async () => {
      const serverTime = await fetchServerTime();
      if (serverTime !== null && serverTime >= 0) {
        setTimeRemaining(serverTime);
        setIsInitialized(true);
      } else if (duration && duration > 0) {
        // Fallback to provided duration
        setTimeRemaining(duration);
        setIsInitialized(true);
      }
    };
    
    initializeTimer();
  }, [submissionId, duration, isInitialized]);

  // Sync with server every 30 seconds
  useEffect(() => {
    if (!submissionId || !isInitialized) return;
    
    const syncWithServer = async () => {
      const serverTime = await fetchServerTime();
      if (serverTime !== null && serverTime >= 0) {
        setTimeRemaining(serverTime);
      }
    };
    
    syncIntervalRef.current = setInterval(syncWithServer, 30000);
    
    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
    };
  }, [submissionId, isInitialized]);

  // Countdown timer
  useEffect(() => {
    if (!isInitialized || timeRemaining <= 0) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    
    intervalRef.current = setInterval(() => {
      setTimeRemaining(prev => {
        const newTime = prev - 1;
        
        // Show warnings
        if (newTime === 300 && prev > 300) {
          toast.warning('5 minutes remaining!', { duration: 5000 });
        } else if (newTime === 60 && prev > 60) {
          toast.error('1 minute remaining!', { duration: 5000 });
        } else if (newTime === 30 && prev > 30) {
          toast.error('30 seconds remaining!', { duration: 5000 });
        }
        
        // Time up
        if (newTime <= 0) {
          if (onTimeUpRef.current) {
            onTimeUpRef.current();
          }
          toast.error('Time is up! Assessment will be submitted automatically.', { 
            duration: 10000 
          });
          return 0;
        }
        
        return newTime;
      });
    }, 1000);
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isInitialized, timeRemaining]);

  // Format time display
  const formatTime = (seconds) => {
    if (seconds < 0) return '0:00';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  // Get color based on time remaining
  const getTimeColor = () => {
    if (timeRemaining <= 60) return 'text-red-600';
    if (timeRemaining <= 300) return 'text-orange-600';
    if (timeRemaining <= 600) return 'text-yellow-600';
    return 'text-gray-700';
  };

  const getTimeBgColor = () => {
    if (timeRemaining <= 60) return 'bg-red-50 border-red-200';
    if (timeRemaining <= 300) return 'bg-orange-50 border-orange-200';
    if (timeRemaining <= 600) return 'bg-yellow-50 border-yellow-200';
    return 'bg-gray-50 border-gray-200';
  };

  const getProgressPercentage = () => {
    if (!duration || duration === 0) return 0;
    return Math.max(0, Math.min(100, ((duration - timeRemaining) / duration) * 100));
  };

  if (!isInitialized) {
    return (
      <div className={`flex items-center space-x-2 ${className}`}>
        <Card className="bg-gray-50 border border-gray-200">
          <CardContent className="p-2">
            <div className="flex items-center space-x-2">
              <Clock className="h-4 w-4 text-gray-400 animate-pulse" />
              <span className="font-mono text-sm font-medium text-gray-400">
                Loading...
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      <Card className={`${getTimeBgColor()} border`}>
        <CardContent className="p-2">
          <div className="flex items-center space-x-2">
            <Clock 
              className={`h-4 w-4 ${getTimeColor()}`}
              role="timer"
              aria-live="polite"
              aria-label={`Time remaining: ${formatTime(timeRemaining)}`}
            />
            <span 
              className={`font-mono text-sm font-medium ${getTimeColor()}`}
              role="timer"
              aria-live="polite"
            >
              {formatTime(timeRemaining)}
            </span>
            
            {/* Sync status indicator */}
            {submissionId && (
              <div 
                className="flex items-center ml-1" 
                title={
                  syncStatus === 'synced' ? 'Timer synced with server' : 
                  syncStatus === 'syncing' ? 'Syncing...' : 
                  'Sync error'
                }
                aria-label={`Sync status: ${syncStatus}`}
              >
                {syncStatus === 'synced' && (
                  <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                )}
                {syncStatus === 'syncing' && (
                  <div className="w-1.5 h-1.5 bg-yellow-500 rounded-full animate-pulse" />
                )}
                {syncStatus === 'error' && (
                  <div className="w-1.5 h-1.5 bg-red-500 rounded-full" />
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      
      {/* Progress Bar */}
      <div className="w-20 bg-gray-200 rounded-full h-1" role="progressbar" aria-valuenow={getProgressPercentage()} aria-valuemin="0" aria-valuemax="100">
        <div 
          className={`h-1 rounded-full transition-all duration-1000 ${
            timeRemaining <= 60 ? 'bg-red-500' :
            timeRemaining <= 300 ? 'bg-orange-500' :
            timeRemaining <= 600 ? 'bg-yellow-500' :
            'bg-blue-500'
          }`}
          style={{ width: `${getProgressPercentage()}%` }}
        />
      </div>
      
      {/* Warning Messages */}
      {timeRemaining <= 60 && timeRemaining > 0 && (
        <Alert variant="destructive" className="ml-2">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Time almost up!
          </AlertDescription>
        </Alert>
      )}
      
      {/* Hidden aria-live region for screen readers */}
      <div 
        className="sr-only" 
        role="status" 
        aria-live="assertive"
        aria-atomic="true"
      >
        {timeRemaining <= 60 && timeRemaining > 30 && '1 minute remaining'}
        {timeRemaining <= 30 && timeRemaining > 0 && `${timeRemaining} seconds remaining`}
        {timeRemaining === 0 && 'Time is up'}
      </div>
    </div>
  );
});

TimerComponent.displayName = 'TimerComponent';

export default TimerComponent;