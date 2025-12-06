import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Alert, AlertDescription } from './ui/alert';
import { 
    AlertTriangle, 
    Clock, 
    Users, 
    TrendingDown, 
    TrendingUp,
    Bell,
    BellOff,
    Settings,
    RefreshCw,
    Eye,
    EyeOff,
    CheckCircle,
    XCircle
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { getWebSocketUrl, getApiBaseUrl } from '../utils/apiConfig';

const PerformanceAlerts = ({ 
    assessmentId, 
    userRole, 
    onAlertClick,
    autoRefresh = true,
    refreshInterval = 30000 // 30 seconds
}) => {
    const [alerts, setAlerts] = useState([]);
    const [isMonitoring, setIsMonitoring] = useState(false);
    const [alertSettings, setAlertSettings] = useState({
        strugglingThreshold: 30, // minutes
        lowScoreThreshold: 40, // percentage
        inactivityThreshold: 5, // minutes
        completionRateThreshold: 70, // percentage
        enabled: true
    });
    const [filteredAlerts, setFilteredAlerts] = useState([]);
    const [selectedSeverity, setSelectedSeverity] = useState('all');
    const [selectedType, setSelectedType] = useState('all');
    const [isExpanded, setIsExpanded] = useState(false);
    
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
        // WebSocket connection for real-time alerts
        if (wsRef.current) {
            wsRef.current.close();
        }
        
        wsRef.current = new WebSocket(getWebSocketUrl(`ws/alerts/${assessmentId}`));
        
        wsRef.current.onopen = () => {
            console.log('Alerts WebSocket connected');
        };
        
        wsRef.current.onmessage = (event) => {
            const data = JSON.parse(event.data);
            handleRealTimeAlert(data);
        };
        
        wsRef.current.onclose = () => {
            console.log('Alerts WebSocket disconnected');
        };
        
        wsRef.current.onerror = (error) => {
            console.error('Alerts WebSocket error:', error);
        };

        // HTTP polling as fallback
        if (autoRefresh) {
            intervalRef.current = setInterval(() => {
                loadAlerts();
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

    const loadAlerts = async () => {
        try {
            const apiBaseUrl = getApiBaseUrl();
            const response = await fetch(`${apiBaseUrl}/analytics/performance-alerts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    assessmentId, 
                    settings: alertSettings 
                })
            });

            if (!response.ok) throw new Error('Failed to load alerts');
            
            const data = await response.json();
            setAlerts(data.alerts || []);
            filterAlerts(data.alerts || []);
        } catch (error) {
            console.error('Error loading alerts:', error);
            toast.error('Failed to load alerts');
        }
    };

    const handleRealTimeAlert = (alert) => {
        setAlerts(prevAlerts => {
            const newAlerts = [...prevAlerts, alert];
            filterAlerts(newAlerts);
            return newAlerts;
        });

        // Show toast notification
        if (alert.severity === 'high') {
            toast.error(alert.message, { duration: 5000 });
        } else if (alert.severity === 'medium') {
            toast(alert.message, { icon: '⚠️', duration: 3000 });
        } else {
            toast(alert.message, { icon: 'ℹ️', duration: 2000 });
        }
    };

    const filterAlerts = (alertsToFilter) => {
        let filtered = alertsToFilter;
        
        if (selectedSeverity !== 'all') {
            filtered = filtered.filter(alert => alert.severity === selectedSeverity);
        }
        
        if (selectedType !== 'all') {
            filtered = filtered.filter(alert => alert.type === selectedType);
        }
        
        setFilteredAlerts(filtered);
    };

    const getSeverityColor = (severity) => {
        const colors = {
            'high': 'text-red-600 bg-red-100',
            'medium': 'text-yellow-600 bg-yellow-100',
            'low': 'text-blue-600 bg-blue-100'
        };
        return colors[severity] || 'text-gray-600 bg-gray-100';
    };

    const getSeverityIcon = (severity) => {
        switch (severity) {
            case 'high':
                return <XCircle className="w-4 h-4 text-red-600" />;
            case 'medium':
                return <AlertTriangle className="w-4 h-4 text-yellow-600" />;
            case 'low':
                return <CheckCircle className="w-4 h-4 text-blue-600" />;
            default:
                return <AlertTriangle className="w-4 h-4 text-gray-600" />;
        }
    };

    const getTypeIcon = (type) => {
        switch (type) {
            case 'struggling':
                return <TrendingDown className="w-4 h-4" />;
            case 'inactivity':
                return <Clock className="w-4 h-4" />;
            case 'low_score':
                return <TrendingDown className="w-4 h-4" />;
            case 'completion_rate':
                return <Users className="w-4 h-4" />;
            case 'time_management':
                return <Clock className="w-4 h-4" />;
            default:
                return <AlertTriangle className="w-4 h-4" />;
        }
    };

    const formatTime = (minutes) => {
        if (minutes < 60) return `${minutes}m`;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}h ${mins}m`;
    };

    const handleAlertClick = (alert) => {
        if (onAlertClick) {
            onAlertClick(alert);
        }
    };

    const markAlertAsRead = async (alertId) => {
        try {
            const apiBaseUrl = getApiBaseUrl();
            const response = await fetch(`${apiBaseUrl}/analytics/mark-alert-read`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ alertId })
            });

            if (!response.ok) throw new Error('Failed to mark alert as read');
            
            setAlerts(prevAlerts => 
                prevAlerts.map(alert => 
                    alert.id === alertId ? { ...alert, isRead: true } : alert
                )
            );
        } catch (error) {
            console.error('Error marking alert as read:', error);
            toast.error('Failed to mark alert as read');
        }
    };

    const updateAlertSettings = async (newSettings) => {
        try {
            const apiBaseUrl = getApiBaseUrl();
            const response = await fetch(`${apiBaseUrl}/analytics/update-alert-settings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    assessmentId, 
                    settings: newSettings 
                })
            });

            if (!response.ok) throw new Error('Failed to update settings');
            
            setAlertSettings(newSettings);
            toast.success('Alert settings updated');
        } catch (error) {
            console.error('Error updating alert settings:', error);
            toast.error('Failed to update settings');
        }
    };

    const getAlertCounts = () => {
        const counts = {
            total: alerts.length,
            unread: alerts.filter(alert => !alert.isRead).length,
            high: alerts.filter(alert => alert.severity === 'high').length,
            medium: alerts.filter(alert => alert.severity === 'medium').length,
            low: alerts.filter(alert => alert.severity === 'low').length
        };
        return counts;
    };

    const counts = getAlertCounts();

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900">Performance Alerts</h2>
                    <p className="text-gray-600 mt-1">Monitor student performance and identify issues</p>
                </div>
                <div className="flex gap-2">
                    <Button 
                        variant={isMonitoring ? "destructive" : "default"}
                        onClick={() => setIsMonitoring(!isMonitoring)}
                    >
                        {isMonitoring ? (
                            <>
                                <BellOff className="w-4 h-4 mr-2" />
                                Stop Monitoring
                            </>
                        ) : (
                            <>
                                <Bell className="w-4 h-4 mr-2" />
                                Start Monitoring
                            </>
                        )}
                    </Button>
                    <Button variant="outline" onClick={loadAlerts}>
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Refresh
                    </Button>
                </div>
            </div>

            {/* Alert Summary */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center">
                            <div className="p-2 bg-blue-100 rounded-lg">
                                <Bell className="w-6 h-6 text-blue-600" />
                            </div>
                            <div className="ml-4">
                                <p className="text-sm font-medium text-gray-600">Total Alerts</p>
                                <p className="text-2xl font-bold text-gray-900">{counts.total}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center">
                            <div className="p-2 bg-red-100 rounded-lg">
                                <XCircle className="w-6 h-6 text-red-600" />
                            </div>
                            <div className="ml-4">
                                <p className="text-sm font-medium text-gray-600">High Priority</p>
                                <p className="text-2xl font-bold text-gray-900">{counts.high}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center">
                            <div className="p-2 bg-yellow-100 rounded-lg">
                                <AlertTriangle className="w-6 h-6 text-yellow-600" />
                            </div>
                            <div className="ml-4">
                                <p className="text-sm font-medium text-gray-600">Medium Priority</p>
                                <p className="text-2xl font-bold text-gray-900">{counts.medium}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center">
                            <div className="p-2 bg-green-100 rounded-lg">
                                <CheckCircle className="w-6 h-6 text-green-600" />
                            </div>
                            <div className="ml-4">
                                <p className="text-sm font-medium text-gray-600">Unread</p>
                                <p className="text-2xl font-bold text-gray-900">{counts.unread}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Filters */}
            <Card>
                <CardHeader>
                    <div className="flex justify-between items-center">
                        <CardTitle>Alert Filters</CardTitle>
                        <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => setIsExpanded(!isExpanded)}
                        >
                            {isExpanded ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </Button>
                    </div>
                </CardHeader>
                {isExpanded && (
                    <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium text-gray-700">Severity</label>
                                <select 
                                    value={selectedSeverity} 
                                    onChange={(e) => setSelectedSeverity(e.target.value)}
                                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                                >
                                    <option value="all">All Severities</option>
                                    <option value="high">High</option>
                                    <option value="medium">Medium</option>
                                    <option value="low">Low</option>
                                </select>
                            </div>
                            
                            <div>
                                <label className="text-sm font-medium text-gray-700">Type</label>
                                <select 
                                    value={selectedType} 
                                    onChange={(e) => setSelectedType(e.target.value)}
                                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                                >
                                    <option value="all">All Types</option>
                                    <option value="struggling">Struggling</option>
                                    <option value="inactivity">Inactivity</option>
                                    <option value="low_score">Low Score</option>
                                    <option value="completion_rate">Completion Rate</option>
                                    <option value="time_management">Time Management</option>
                                </select>
                            </div>
                        </div>
                    </CardContent>
                )}
            </Card>

            {/* Alerts List */}
            <Card>
                <CardHeader>
                    <CardTitle>Recent Alerts</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {filteredAlerts.length === 0 ? (
                            <div className="text-center py-8">
                                <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
                                <p className="text-gray-500">No alerts found</p>
                            </div>
                        ) : (
                            filteredAlerts.map((alert, index) => (
                                <div 
                                    key={index} 
                                    className={`p-4 border rounded-lg cursor-pointer hover:bg-gray-50 ${
                                        !alert.isRead ? 'bg-blue-50 border-blue-200' : ''
                                    }`}
                                    onClick={() => handleAlertClick(alert)}
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-start space-x-3">
                                            <div className="flex-shrink-0">
                                                {getSeverityIcon(alert.severity)}
                                            </div>
                                            
                                            <div className="flex-1">
                                                <div className="flex items-center space-x-2 mb-2">
                                                    <h4 className="font-medium text-gray-900">
                                                        {alert.title}
                                                    </h4>
                                                    <Badge className={getSeverityColor(alert.severity)}>
                                                        {alert.severity.toUpperCase()}
                                                    </Badge>
                                                    <Badge variant="outline">
                                                        {alert.type.replace('_', ' ').toUpperCase()}
                                                    </Badge>
                                                </div>
                                                
                                                <p className="text-sm text-gray-600 mb-2">
                                                    {alert.message}
                                                </p>
                                                
                                                <div className="flex items-center space-x-4 text-xs text-gray-500">
                                                    <span>{new Date(alert.timestamp).toLocaleString()}</span>
                                                    {alert.studentName && (
                                                        <span>Student: {alert.studentName}</span>
                                                    )}
                                                    {alert.duration && (
                                                        <span>Duration: {formatTime(alert.duration)}</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        
                                        <div className="flex items-center space-x-2">
                                            {!alert.isRead && (
                                                <Button 
                                                    variant="outline" 
                                                    size="sm"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        markAlertAsRead(alert.id);
                                                    }}
                                                >
                                                    Mark as Read
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Alert Settings */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center space-x-2">
                        <Settings className="w-5 h-5" />
                        <span>Alert Settings</span>
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="text-sm font-medium text-gray-700">
                                Struggling Threshold (minutes)
                            </label>
                            <input 
                                type="number" 
                                value={alertSettings.strugglingThreshold}
                                onChange={(e) => setAlertSettings({
                                    ...alertSettings,
                                    strugglingThreshold: parseInt(e.target.value)
                                })}
                                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                            />
                        </div>
                        
                        <div>
                            <label className="text-sm font-medium text-gray-700">
                                Low Score Threshold (%)
                            </label>
                            <input 
                                type="number" 
                                value={alertSettings.lowScoreThreshold}
                                onChange={(e) => setAlertSettings({
                                    ...alertSettings,
                                    lowScoreThreshold: parseInt(e.target.value)
                                })}
                                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                            />
                        </div>
                        
                        <div>
                            <label className="text-sm font-medium text-gray-700">
                                Inactivity Threshold (minutes)
                            </label>
                            <input 
                                type="number" 
                                value={alertSettings.inactivityThreshold}
                                onChange={(e) => setAlertSettings({
                                    ...alertSettings,
                                    inactivityThreshold: parseInt(e.target.value)
                                })}
                                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                            />
                        </div>
                        
                        <div>
                            <label className="text-sm font-medium text-gray-700">
                                Completion Rate Threshold (%)
                            </label>
                            <input 
                                type="number" 
                                value={alertSettings.completionRateThreshold}
                                onChange={(e) => setAlertSettings({
                                    ...alertSettings,
                                    completionRateThreshold: parseInt(e.target.value)
                                })}
                                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                            />
                        </div>
                    </div>
                    
                    <div className="mt-4">
                        <Button 
                            onClick={() => updateAlertSettings(alertSettings)}
                            className="w-full"
                        >
                            Update Settings
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default PerformanceAlerts;
