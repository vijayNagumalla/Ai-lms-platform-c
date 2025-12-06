import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import { Alert, AlertDescription } from './ui/alert';
import { 
    Users, 
    Clock, 
    CheckCircle, 
    AlertTriangle, 
    Eye, 
    EyeOff,
    RefreshCw,
    Activity,
    Target,
    TrendingUp,
    TrendingDown,
    Pause,
    Play
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { getWebSocketUrl, getApiBaseUrl } from '../utils/apiConfig';

const LiveAssessmentMonitoring = ({ assessmentId, userRole }) => {
    const [monitoringData, setMonitoringData] = useState(null);
    const [isMonitoring, setIsMonitoring] = useState(false);
    const [alerts, setAlerts] = useState([]);
    const [selectedStudent, setSelectedStudent] = useState(null);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [refreshInterval, setRefreshInterval] = useState(5000); // 5 seconds
    
    const intervalRef = useRef(null);
    const wsRef = useRef(null);

    useEffect(() => {
        if (isMonitoring) {
            startMonitoring();
        } else {
            stopMonitoring();
        }
        
        return () => {
            stopMonitoring();
        };
    }, [isMonitoring, autoRefresh, refreshInterval]);

    const startMonitoring = () => {
        // WebSocket connection for real-time updates
        if (wsRef.current) {
            wsRef.current.close();
        }
        
        wsRef.current = new WebSocket(getWebSocketUrl(`ws/assessment/${assessmentId}`));
        
        wsRef.current.onopen = () => {
            console.log('WebSocket connected');
        };
        
        wsRef.current.onmessage = (event) => {
            const data = JSON.parse(event.data);
            handleRealTimeUpdate(data);
        };
        
        wsRef.current.onclose = () => {
            console.log('WebSocket disconnected');
        };
        
        wsRef.current.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        // HTTP polling as fallback
        if (autoRefresh) {
            intervalRef.current = setInterval(() => {
                loadMonitoringData();
            }, refreshInterval);
        }
    };

    const stopMonitoring = () => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
        
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
    };

    const loadMonitoringData = async () => {
        try {
            const apiBaseUrl = getApiBaseUrl();
            const response = await fetch(`${apiBaseUrl}/analytics/live-monitoring`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ assessmentId })
            });

            if (!response.ok) throw new Error('Failed to load monitoring data');
            
            const data = await response.json();
            setMonitoringData(data);
        } catch (error) {
            console.error('Error loading monitoring data:', error);
            toast.error('Failed to load monitoring data');
        }
    };

    const handleRealTimeUpdate = (data) => {
        setMonitoringData(prevData => ({
            ...prevData,
            ...data
        }));

        // Check for alerts
        if (data.alerts) {
            data.alerts.forEach(alert => {
                if (alert.severity === 'high') {
                    toast.error(alert.message);
                } else if (alert.severity === 'medium') {
                    toast(alert.message, { icon: '⚠️' });
                }
            });
        }
    };

    const getStatusColor = (status) => {
        const colors = {
            'active': 'bg-green-100 text-green-800',
            'paused': 'bg-yellow-100 text-yellow-800',
            'completed': 'bg-blue-100 text-blue-800',
            'abandoned': 'bg-red-100 text-red-800',
            'struggling': 'bg-orange-100 text-orange-800'
        };
        return colors[status] || 'bg-gray-100 text-gray-800';
    };

    const getProgressColor = (progress) => {
        if (progress >= 80) return 'text-green-600';
        if (progress >= 50) return 'text-blue-600';
        if (progress >= 25) return 'text-yellow-600';
        return 'text-red-600';
    };

    const formatTime = (minutes) => {
        if (minutes < 60) return `${minutes}m`;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}h ${mins}m`;
    };

    const getTimeRemaining = (startTime, duration) => {
        const elapsed = (Date.now() - new Date(startTime).getTime()) / (1000 * 60);
        const remaining = Math.max(0, duration - elapsed);
        return remaining;
    };

    if (!monitoringData) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Live Assessment Monitoring</h1>
                    <p className="text-gray-600 mt-1">Real-time tracking of assessment progress</p>
                </div>
                <div className="flex gap-2">
                    <Button 
                        variant={isMonitoring ? "destructive" : "default"}
                        onClick={() => setIsMonitoring(!isMonitoring)}
                    >
                        {isMonitoring ? (
                            <>
                                <Pause className="w-4 h-4 mr-2" />
                                Stop Monitoring
                            </>
                        ) : (
                            <>
                                <Play className="w-4 h-4 mr-2" />
                                Start Monitoring
                            </>
                        )}
                    </Button>
                    <Button variant="outline" onClick={loadMonitoringData}>
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Refresh
                    </Button>
                </div>
            </div>

            {/* Monitoring Status */}
            <Card>
                <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4">
                            <div className="flex items-center space-x-2">
                                <div className={`w-3 h-3 rounded-full ${
                                    isMonitoring ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
                                }`}></div>
                                <span className="text-sm font-medium">
                                    {isMonitoring ? 'Monitoring Active' : 'Monitoring Inactive'}
                                </span>
                            </div>
                            
                            <div className="flex items-center space-x-2">
                                <Activity className="w-4 h-4 text-blue-500" />
                                <span className="text-sm text-gray-600">
                                    {monitoringData.totalStudents} students
                                </span>
                            </div>
                            
                            <div className="flex items-center space-x-2">
                                <Clock className="w-4 h-4 text-orange-500" />
                                <span className="text-sm text-gray-600">
                                    {monitoringData.averageTimeSpent} min avg
                                </span>
                            </div>
                        </div>
                        
                        <div className="flex items-center space-x-2">
                            <Badge variant="outline">
                                {monitoringData.completedCount} completed
                            </Badge>
                            <Badge variant="outline">
                                {monitoringData.activeCount} active
                            </Badge>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <Card>
                    <CardContent className="p-6">
                        <div className="flex items-center">
                            <div className="p-2 bg-blue-100 rounded-lg">
                                <Users className="w-6 h-6 text-blue-600" />
                            </div>
                            <div className="ml-4">
                                <p className="text-sm font-medium text-gray-600">Total Students</p>
                                <p className="text-2xl font-bold text-gray-900">
                                    {monitoringData.totalStudents}
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="p-6">
                        <div className="flex items-center">
                            <div className="p-2 bg-green-100 rounded-lg">
                                <CheckCircle className="w-6 h-6 text-green-600" />
                            </div>
                            <div className="ml-4">
                                <p className="text-sm font-medium text-gray-600">Completed</p>
                                <p className="text-2xl font-bold text-gray-900">
                                    {monitoringData.completedCount}
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="p-6">
                        <div className="flex items-center">
                            <div className="p-2 bg-yellow-100 rounded-lg">
                                <Clock className="w-6 h-6 text-yellow-600" />
                            </div>
                            <div className="ml-4">
                                <p className="text-sm font-medium text-gray-600">In Progress</p>
                                <p className="text-2xl font-bold text-gray-900">
                                    {monitoringData.activeCount}
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="p-6">
                        <div className="flex items-center">
                            <div className="p-2 bg-red-100 rounded-lg">
                            <AlertTriangle className="w-6 h-6 text-red-600" />
                            </div>
                            <div className="ml-4">
                                <p className="text-sm font-medium text-gray-600">Struggling</p>
                                <p className="text-2xl font-bold text-gray-900">
                                    {monitoringData.strugglingCount}
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Alerts */}
            {alerts.length > 0 && (
                <div className="space-y-2">
                    {alerts.map((alert, index) => (
                        <Alert key={index} className={
                            alert.severity === 'high' ? 'border-red-200 bg-red-50' :
                            alert.severity === 'medium' ? 'border-yellow-200 bg-yellow-50' :
                            'border-blue-200 bg-blue-50'
                        }>
                            <AlertTriangle className="w-4 h-4" />
                            <AlertDescription>
                                {alert.message}
                            </AlertDescription>
                        </Alert>
                    ))}
                </div>
            )}

            {/* Student Progress */}
            <Card>
                <CardHeader>
                    <CardTitle>Student Progress</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {monitoringData.students?.map((student, index) => (
                            <div key={index} className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50">
                                <div className="flex items-center space-x-4">
                                    <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                                        <span className="text-sm font-medium text-gray-600">
                                            {student.name.charAt(0)}
                                        </span>
                                    </div>
                                    
                                    <div>
                                        <p className="font-medium text-gray-900">{student.name}</p>
                                        <p className="text-sm text-gray-600">{student.email}</p>
                                    </div>
                                </div>
                                
                                <div className="flex items-center space-x-4">
                                    <div className="text-center">
                                        <p className="text-sm text-gray-600">Progress</p>
                                        <p className={`font-bold ${getProgressColor(student.progress)}`}>
                                            {student.progress}%
                                        </p>
                                    </div>
                                    
                                    <div className="text-center">
                                        <p className="text-sm text-gray-600">Time</p>
                                        <p className="font-bold text-gray-900">
                                            {formatTime(student.timeSpent)}
                                        </p>
                                    </div>
                                    
                                    <div className="text-center">
                                        <p className="text-sm text-gray-600">Remaining</p>
                                        <p className="font-bold text-gray-900">
                                            {formatTime(getTimeRemaining(student.startTime, student.duration))}
                                        </p>
                                    </div>
                                    
                                    <Badge className={getStatusColor(student.status)}>
                                        {student.status}
                                    </Badge>
                                    
                                    <Button 
                                        variant="outline" 
                                        size="sm"
                                        onClick={() => setSelectedStudent(student)}
                                    >
                                        <Eye className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {/* Progress Overview */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Completion Progress</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-gray-600">Overall Progress</span>
                                <span className="font-bold">{monitoringData.overallProgress}%</span>
                            </div>
                            <Progress value={monitoringData.overallProgress} className="w-full" />
                            
                            <div className="grid grid-cols-2 gap-4 mt-4">
                                <div className="text-center">
                                    <p className="text-2xl font-bold text-green-600">
                                        {monitoringData.completionRate}%
                                    </p>
                                    <p className="text-sm text-gray-600">Completion Rate</p>
                                </div>
                                <div className="text-center">
                                    <p className="text-2xl font-bold text-blue-600">
                                        {monitoringData.averageScore}%
                                    </p>
                                    <p className="text-sm text-gray-600">Average Score</p>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Time Analysis</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-gray-600">Average Time</span>
                                <span className="font-bold">{formatTime(monitoringData.averageTimeSpent)}</span>
                            </div>
                            
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-gray-600">Fastest Completion</span>
                                <span className="font-bold">{formatTime(monitoringData.fastestCompletion)}</span>
                            </div>
                            
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-gray-600">Slowest Completion</span>
                                <span className="font-bold">{formatTime(monitoringData.slowestCompletion)}</span>
                            </div>
                            
                            <div className="mt-4">
                                <div className="flex justify-between text-sm text-gray-600 mb-1">
                                    <span>Time Distribution</span>
                                </div>
                                <div className="space-y-2">
                                    <div className="flex justify-between items-center">
                                        <span className="text-xs">Fast (&lt; 30 min)</span>
                                        <span className="text-xs font-medium">{monitoringData.timeDistribution?.fast || 0}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-xs">Normal (30-60 min)</span>
                                        <span className="text-xs font-medium">{monitoringData.timeDistribution?.normal || 0}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-xs">Slow (&gt; 60 min)</span>
                                        <span className="text-xs font-medium">{monitoringData.timeDistribution?.slow || 0}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Student Detail Modal */}
            {selectedStudent && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <Card className="w-full max-w-2xl mx-4">
                        <CardHeader>
                            <div className="flex justify-between items-center">
                                <CardTitle>{selectedStudent.name} - Assessment Progress</CardTitle>
                                <Button variant="outline" onClick={() => setSelectedStudent(null)}>
                                    <EyeOff className="w-4 h-4" />
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-sm text-gray-600">Email</p>
                                        <p className="font-medium">{selectedStudent.email}</p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-gray-600">Status</p>
                                        <Badge className={getStatusColor(selectedStudent.status)}>
                                            {selectedStudent.status}
                                        </Badge>
                                    </div>
                                </div>
                                
                                <div className="grid grid-cols-3 gap-4">
                                    <div className="text-center">
                                        <p className="text-2xl font-bold text-blue-600">
                                            {selectedStudent.progress}%
                                        </p>
                                        <p className="text-sm text-gray-600">Progress</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-2xl font-bold text-green-600">
                                            {formatTime(selectedStudent.timeSpent)}
                                        </p>
                                        <p className="text-sm text-gray-600">Time Spent</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-2xl font-bold text-orange-600">
                                            {formatTime(getTimeRemaining(selectedStudent.startTime, selectedStudent.duration))}
                                        </p>
                                        <p className="text-sm text-gray-600">Time Remaining</p>
                                    </div>
                                </div>
                                
                                <div>
                                    <p className="text-sm text-gray-600 mb-2">Question Progress</p>
                                    <Progress value={selectedStudent.progress} className="w-full" />
                                </div>
                                
                                {selectedStudent.questions && (
                                    <div>
                                        <p className="text-sm text-gray-600 mb-2">Question Status</p>
                                        <div className="grid grid-cols-5 gap-2">
                                            {selectedStudent.questions.map((question, index) => (
                                                <div key={index} className={`w-8 h-8 rounded flex items-center justify-center text-xs ${
                                                    question.answered ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'
                                                }`}>
                                                    {index + 1}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
};

export default LiveAssessmentMonitoring;
