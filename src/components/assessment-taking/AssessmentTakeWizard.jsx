import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { 
  ArrowLeft, 
  ArrowRight, 
  CheckCircle, 
  AlertTriangle,
  Clock,
  Users,
  Shield,
  Eye,
  Play,
  Save,
  Flag,
  Code,
  FileText,
  Monitor,
  Menu,
  Wifi,
  WifiOff,
  Loader2
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '@/components/ThemeProvider';
import { Moon, Sun, Maximize2, Minimize2 } from 'lucide-react';

// Import step components
import AssessmentDescriptionStep from './steps/AssessmentDescriptionStep';
import TermsAgreementStep from './steps/TermsAgreementStep';
import ProctoringSetupStep from './steps/ProctoringSetupStep';
import QuestionTakingStep from './steps/QuestionTakingStep';
import SubmissionConfirmationStep from './steps/SubmissionConfirmationStep';
import AssessmentResultsStep from './steps/AssessmentResultsStep';
import SectionStartStep from './steps/SectionStartStep';
import SectionCompletionStep from './steps/SectionCompletionStep';

// Import services
import ProctoringMonitor from './ProctoringMonitor';
import TimerComponent from './TimerComponent';
import apiService from '@/services/api';
// CRITICAL FIX: Import encryption service for sensitive data
import encryptionService from '@/utils/encryption';

const AssessmentTakeWizard = () => {
  const { assessmentId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  
  // Main state
  const [currentStep, setCurrentStep] = useState(0);
  const [assessment, setAssessment] = useState(null);
  const [submission, setSubmission] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isRetake, setIsRetake] = useState(false);
  
  // Step completion tracking
  const [completedSteps, setCompletedSteps] = useState(new Set());
  
  // Assessment taking state
  const [answers, setAnswers] = useState({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [currentStepType, setCurrentStepType] = useState(null); // 'section-start', 'questions', 'section-completion'
  const [timeSpent, setTimeSpent] = useState({});
  const [flaggedQuestions, setFlaggedQuestions] = useState(new Set());
  const [saving, setSaving] = useState(false);
  
  // Proctoring state
  const [proctoringEnabled, setProctoringEnabled] = useState(false);
  const [proctoringPermissions, setProctoringPermissions] = useState({});
  const [proctoringViolations, setProctoringViolations] = useState([]);
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [offlineQueue, setOfflineQueue] = useState([]);
  const offlineQueueRef = useRef(offlineQueue);
  
  // Refs
  const autoSaveInterval = useRef(null);
  const questionStartTime = useRef(Date.now());
  const proctoringRef = useRef(null);
  const questionTakingRef = useRef(null);
  const timerRef = useRef(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const timerInitializedRef = useRef(false);
  const isNavigatingRef = useRef(false);
  const answersRef = useRef(answers);
  const submissionRef = useRef(submission);
  const isSyncingOfflineQueueRef = useRef(false);
  // CRITICAL FIX: Track all timeouts for cleanup
  const activeTimeoutsRef = useRef([]);
  const debounceTimeouts = useRef({});
  
  // Keep refs in sync with state
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);
  
  useEffect(() => {
    submissionRef.current = submission;
  }, [submission]);

  // Define steps based on assessment requirements
  const getSteps = () => {
    const baseSteps = [
      { 
        id: 'description', 
        title: 'Assessment Description', 
        icon: <FileText className="h-5 w-5" />,
        component: AssessmentDescriptionStep
      },
      { 
        id: 'terms', 
        title: 'Terms & Conditions', 
        icon: <CheckCircle className="h-5 w-5" />,
        component: TermsAgreementStep
      }
    ];

    // Add proctoring step if enabled
    if (assessment?.require_proctoring) {
      baseSteps.push({
        id: 'proctoring',
        title: 'Proctoring Setup',
        icon: <Shield className="h-5 w-5" />,
        component: ProctoringSetupStep
      });
    }

    // If sections exist, create section-based flow
    if (sections && sections.length > 0) {
      sections.forEach((section, index) => {
        // Section Start Step
        baseSteps.push({
          id: `section-start-${index}`,
          sectionIndex: index,
          title: `${section.name || `Section ${index + 1}`} - Start`,
          icon: <Play className="h-5 w-5" />,
          component: SectionStartStep,
          stepType: 'section-start'
        });

        // Section Questions Step
        baseSteps.push({
          id: `section-questions-${index}`,
          sectionIndex: index,
          title: `${section.name || `Section ${index + 1}`} - Questions`,
          icon: <Monitor className="h-5 w-5" />,
          component: QuestionTakingStep,
          stepType: 'questions'
        });

        // Section Completion Step
        baseSteps.push({
          id: `section-completion-${index}`,
          sectionIndex: index,
          title: `${section.name || `Section ${index + 1}`} - Complete`,
          icon: <CheckCircle className="h-5 w-5" />,
          component: SectionCompletionStep,
          stepType: 'section-completion'
        });
      });
    } else {
      // No sections - add single question taking step
    baseSteps.push({
      id: 'questions',
      title: 'Assessment Questions',
      icon: <Monitor className="h-5 w-5" />,
        component: QuestionTakingStep,
        stepType: 'questions'
    });
    }

    // Add final submission step
    baseSteps.push({
      id: 'submission',
      title: 'Submit Assessment',
      icon: <Save className="h-5 w-5" />,
      component: SubmissionConfirmationStep
    });

    // Add results step if immediate results are enabled
    if (assessment?.show_results_immediately) {
      baseSteps.push({
        id: 'results',
        title: 'Assessment Results',
        icon: <CheckCircle className="h-5 w-5" />,
        component: AssessmentResultsStep
      });
    }

    return baseSteps;
  };

  // Calculate steps - this will be recalculated when sections change
  const steps = useMemo(() => {
    if (!assessment) return [];
    return getSteps();
  }, [assessment, sections, questions]);

  useEffect(() => {
    offlineQueueRef.current = offlineQueue;
  }, [offlineQueue]);

  const currentStepData = steps[currentStep] || null;

  useEffect(() => {
    initializeAssessment();
    return () => {
      if (autoSaveInterval.current) {
        clearInterval(autoSaveInterval.current);
      }
    };
  }, [assessmentId]);

  useEffect(() => {
    // Check if this is a retake from localStorage
    const retakeFlag = localStorage.getItem(`retake_${assessmentId}`);
    if (retakeFlag === 'true') {
      setIsRetake(true);
      localStorage.removeItem(`retake_${assessmentId}`);
    }
  }, [assessmentId]);

  // Sync offline queue when back online
  const syncOfflineQueue = useCallback(async () => {
    if (!submission || !isOnline) return;

    // Prevent concurrent syncs
    if (isSyncingOfflineQueueRef.current) {
      return;
    }

    const submissionId = submission.id || submission.submissionId;
    if (!submissionId) {
      return;
    }

    const queueSnapshot = [...offlineQueueRef.current];
    if (queueSnapshot.length === 0) {
      return;
    }

    isSyncingOfflineQueueRef.current = true;

    try {
      let successCount = 0;
      let failCount = 0;
      const successfulEntryKeys = new Set();

      const buildEntryKey = (item) => `${item.questionId}:${item.timestamp || 'no-ts'}`;

      for (const entry of queueSnapshot) {
        const { questionId, answer, timeSpent, timestamp } = entry;
        // Skip null/undefined answers
        if (answer === null || answer === undefined) {
          continue;
        }

        try {
          await apiService.saveAnswer(submissionId, {
            questionId,
            answer,
            timeSpent
          });
          successCount++;
          successfulEntryKeys.add(buildEntryKey(entry));

          // Remove from localStorage on success
          if (typeof Storage !== 'undefined') {
            const offlineKey = `offline_answer_${submissionId}_${questionId}`;
            const storedValue = localStorage.getItem(offlineKey);

            if (storedValue) {
              try {
                const decrypted = await encryptionService.decrypt(storedValue);
                if (decrypted?.timestamp && decrypted.timestamp !== timestamp) {
                  // A newer entry exists, skip removal
                  continue;
                }
              } catch (decryptError) {
                // If decryption fails, fall back to removing the entry
                logger.debug('Failed to decrypt offline answer during cleanup:', decryptError);
              }
            }

            localStorage.removeItem(offlineKey);
          }
        } catch (error) {
          logger.error(`Failed to sync answer for question ${questionId}:`, error);
          failCount++;
        }
      }

      if (successCount > 0) {
        setOfflineQueue(prev => prev.filter(item => !successfulEntryKeys.has(buildEntryKey(item))));

        if (failCount === 0) {
          toast.success('All answers synced successfully');
        } else {
          toast.warning(`${successCount} answers synced, ${failCount} failed`);
        }
      } else if (failCount > 0) {
        toast.error('Failed to sync offline answers. We will retry automatically.');
      }
    } catch (error) {
      logger.error('Error syncing offline queue:', error);
    } finally {
      isSyncingOfflineQueueRef.current = false;
    }
  }, [submission, isOnline]);

  // Network status monitoring
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      toast.success('Connection restored');
      // Sync offline queue when back online
      if (offlineQueue.length > 0 && submission) {
        syncOfflineQueue();
      }
    };
    
    const handleOffline = () => {
      setIsOnline(false);
      toast.error('Connection lost. Answers will be saved when connection is restored.');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [offlineQueue, submission, syncOfflineQueue]);

  // Sync answers state with server periodically and update sessionStorage
  useEffect(() => {
    if (!submission || !isOnline) return;
    
    const syncAnswersWithServer = async () => {
      try {
        const submissionId = submission.id || submission.submissionId;
        const token = localStorage.getItem('token') || localStorage.getItem('lmsToken');
        const { getApiBaseUrl } = await import('../../utils/apiConfig');
        const apiBaseUrl = getApiBaseUrl();
        const answersResponse = await fetch(`${apiBaseUrl}/student-assessments/${submissionId}/answers`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (answersResponse.ok) {
          // Check if response is actually JSON
          const contentType = answersResponse.headers.get('content-type');
          if (!contentType || !contentType.includes('application/json')) {
            console.error('Response is not JSON:', contentType);
            return; // Skip sync if not JSON
          }
          
          const answersData = await answersResponse.json();
          if (answersData.data && Array.isArray(answersData.data)) {
            const serverAnswers = {};
            answersData.data.forEach(response => {
              if (response.answer !== null && response.answer !== undefined) {
                try {
                  const parsedAnswer = typeof response.answer === 'string' 
                    ? JSON.parse(response.answer) 
                    : response.answer;
                  serverAnswers[response.question_id] = parsedAnswer;
                } catch (e) {
                  serverAnswers[response.question_id] = response.answer;
                }
              }
            });
            
            // Merge server answers with local answers (local takes precedence if changed)
            setAnswers(prev => {
              const merged = { ...serverAnswers };
              // Keep local answers that have been modified recently (within last 5 seconds)
              Object.keys(prev).forEach(key => {
                if (prev[key] !== undefined && prev[key] !== null) {
                  merged[key] = prev[key];
                }
              });
              
              // CRITICAL FIX: Update sessionStorage cache with encryption
              if (typeof Storage !== 'undefined') {
                const sessionKey = `assessment_answers_${submissionId}`;
                const dataToStore = {
                  answers: merged,
                  timestamp: Date.now()
                };
                
                encryptionService.encrypt(dataToStore)
                  .then(encryptedData => {
                    sessionStorage.setItem(sessionKey, encryptedData);
                  })
                  .catch(encryptError => {
                    logger.error('Error encrypting session data:', encryptError);
                    // Fallback: store without encryption if encryption fails
                    sessionStorage.setItem(sessionKey, JSON.stringify(dataToStore));
                  });
              }
              
              return merged;
            });
          }
        }
      } catch (error) {
        logger.error('Error syncing answers with server:', error);
      }
    };
    
    // Sync every 60 seconds
    const syncInterval = setInterval(syncAnswersWithServer, 60000);
    
    return () => clearInterval(syncInterval);
  }, [submission, isOnline]);
  
  // Save answers to sessionStorage whenever they change
  useEffect(() => {
    if (!submission || Object.keys(answers).length === 0) return;
    
    const sessionKey = `assessment_answers_${submission.id || submission.submissionId}`;
    if (typeof Storage !== 'undefined') {
      sessionStorage.setItem(sessionKey, JSON.stringify({
        answers,
        timestamp: Date.now()
      }));
    }
  }, [answers, submission]);

  // Update currentSectionIndex when step changes
  useEffect(() => {
    if (currentStepData?.sectionIndex !== undefined && currentSectionIndex !== currentStepData.sectionIndex) {
      setCurrentSectionIndex(currentStepData.sectionIndex);
      
      // If moving to a questions step, also update currentQuestionIndex to first question of that section
      if (currentStepData.stepType === 'questions' && sections[currentStepData.sectionIndex]) {
        const sectionQuestions = questions.filter(q => q.section_id === sections[currentStepData.sectionIndex].id);
        if (sectionQuestions.length > 0) {
          const firstQuestionIndex = questions.findIndex(q => q.id === sectionQuestions[0].id);
          if (firstQuestionIndex >= 0) {
            setCurrentQuestionIndex(firstQuestionIndex);
          }
        }
      }
    }
  }, [currentStep, currentStepData, currentSectionIndex, sections, questions]);

  useEffect(() => {
    // Start auto-save interval when in question taking step
    const questionStepIndex = steps.findIndex(step => step.stepType === 'questions' || step.id === 'questions');
    if (currentStep === questionStepIndex && submission) {
      autoSaveInterval.current = setInterval(autoSave, 30000); // 30 seconds
      
      // Initialize proctoring ONLY when question-taking begins
      if (proctoringEnabled && proctoringRef.current) {
        initializeProctoring();
      }
      
      // MEDIUM FIX: Cleanup function to clear auto-save interval
      return () => {
        if (autoSaveInterval.current) {
          clearInterval(autoSaveInterval.current);
          autoSaveInterval.current = null;
        }
        // Also cleanup all debounce timeouts
        Object.values(debounceTimeouts.current).forEach(timeoutId => {
          if (timeoutId) clearTimeout(timeoutId);
        });
        debounceTimeouts.current = {};
        // Cleanup active timeouts
        activeTimeoutsRef.current.forEach(timeoutId => {
          if (timeoutId) clearTimeout(timeoutId);
        });
        activeTimeoutsRef.current = [];
      };
    } else {
      if (autoSaveInterval.current) {
        clearInterval(autoSaveInterval.current);
      }
    }

    return () => {
      if (autoSaveInterval.current) {
        clearInterval(autoSaveInterval.current);
      }
    };
  }, [currentStep, submission, proctoringEnabled, steps]);

  // Update sessionStorage with answers and timeSpent periodically
  useEffect(() => {
    if (submission && (Object.keys(answers).length > 0 || Object.keys(timeSpent).length > 0)) {
      const submissionId = submission.id || submission.submissionId;
      if (submissionId) {
        const sessionKey = `assessment_answers_${submissionId}`;
        
        // CRITICAL FIX: Use async IIFE for decryption
        (async () => {
          // Get existing data from sessionStorage to merge
          const existing = sessionStorage.getItem(sessionKey);
          let existingData = { answers: {}, timeSpent: {} };
          
          if (existing) {
            try {
              // CRITICAL FIX: Try to decrypt first (new encrypted format)
              existingData = await encryptionService.decrypt(existing);
            } catch (decryptError) {
              // Fallback: try parsing as plain JSON (backward compatibility)
              try {
                existingData = JSON.parse(existing);
              } catch (parseError) {
                // Ignore parse errors
                existingData = { answers: {}, timeSpent: {} };
              }
            }
          }
          
          // Merge with current state (current state takes precedence)
          const mergedData = {
            answers: { ...existingData.answers, ...answers },
            timeSpent: { ...existingData.timeSpent, ...timeSpent },
            timestamp: Date.now()
          };
          
          // CRITICAL FIX: Encrypt sensitive data before storing
          try {
            const encryptedData = await encryptionService.encrypt(mergedData);
            sessionStorage.setItem(sessionKey, encryptedData);
          } catch (encryptError) {
            console.error('Error encrypting session data:', encryptError);
            // Fallback: store without encryption if encryption fails
            sessionStorage.setItem(sessionKey, JSON.stringify(mergedData));
          }
        })();
      }
    }
  }, [answers, timeSpent, submission]);

  // Track time spent on each question - improved version
  useEffect(() => {
    // Only track time when we're actually viewing a question
    const questionStepIndex = steps.findIndex(step => 
      step.stepType === 'questions' || 
      step.id === 'questions' || 
      step.id?.startsWith('section-questions-')
    );
    
    if (questionStepIndex === currentStep && questions[currentQuestionIndex]) {
      const questionId = questions[currentQuestionIndex].id;
      questionStartTime.current = Date.now();
      
      // Save time when leaving this question
      return () => {
        if (questionStartTime.current && questionId) {
          const timeSpentOnQuestion = Date.now() - questionStartTime.current;
          setTimeSpent(prev => {
            const currentTime = prev[questionId] || 0;
            const newTime = currentTime + timeSpentOnQuestion;
            
            // Save the answer with updated time immediately
            const currentAnswer = answersRef.current[questionId];
            const currentSubmission = submissionRef.current;
            if (currentAnswer !== undefined && currentAnswer !== null && currentSubmission) {
              const submissionId = currentSubmission.id || currentSubmission.submissionId;
              
              // Use the newTime value for saving
              apiService.saveAnswer(submissionId, {
                questionId,
                answer: currentAnswer,
                timeSpent: Math.floor(newTime / 1000)
              }).catch(err => {
                logger.error('Error saving time on question change:', err);
              });
            }
            
            return {
              ...prev,
              [questionId]: newTime
            };
          });
        }
      };
    }
  }, [currentStep, currentQuestionIndex, questions, submission?.id, submission?.submissionId]);

  const initializeAssessment = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get assessment details
      const assessmentResponse = await apiService.getStudentAssessment(assessmentId);
      const assessmentData = assessmentResponse.data || assessmentResponse;
      setAssessment(assessmentData);
      setProctoringEnabled(assessmentData.require_proctoring);

      // Get questions and sections (normalize shapes)
      const questionsResponse = await apiService.getAssessmentQuestions(assessmentId);
      // LOW FIX: Use centralized logger
      logger.debug('Questions Response:', questionsResponse);
      
      const rawQuestions = questionsResponse.data || questionsResponse;
      logger.debug('Raw Questions:', rawQuestions);
      
      // Handle response structure: { assessment, sections, questions } or { data: { questions, sections } }
      const normalizedQuestionsArray = Array.isArray(rawQuestions)
        ? rawQuestions
        : (rawQuestions.questions || rawQuestions.data?.questions || rawQuestions.data || []);
      const normalizedSectionsArray = Array.isArray(rawQuestions?.sections)
        ? rawQuestions.sections
        : (rawQuestions.data?.sections || []);
      
      logger.debug('Normalized Questions:', normalizedQuestionsArray);
      logger.debug('Normalized Sections:', normalizedSectionsArray);

      const normalizedQuestions = (normalizedQuestionsArray || []).map((q, idx) => ({
        // Preserve ALL original fields first (including metadata, coding_details, etc.)
        ...q,
        // Then normalize/ensure required fields exist
        id: q.id || q.question_id || q.uuid || String(idx + 1),
        question_text: q.question_text || q.content || q.title || q.text || `Question ${idx + 1}`,
        question_type: q.question_type || q.type || 'multiple_choice',
        points: q.points ?? 1,
        options: q.options || q.choices || q.options,
        section_id: q.section_id || null
      }));

      setQuestions(normalizedQuestions);
      setSections(normalizedSectionsArray);

      // Initialize section index if sections exist
      if (normalizedSectionsArray && normalizedSectionsArray.length > 0) {
        // If first question has a section, set that as current section
        if (normalizedQuestions.length > 0 && normalizedQuestions[0].section_id) {
          const firstSectionIndex = normalizedSectionsArray.findIndex(s => s.id === normalizedQuestions[0].section_id);
          if (firstSectionIndex >= 0) {
            setCurrentSectionIndex(firstSectionIndex);
          }
        } else {
          // Default to first section
          setCurrentSectionIndex(0);
        }
      }

      // Start assessment attempt
      const startResponse = isRetake 
        ? await apiService.retakeAssessment(assessmentId)
        : await apiService.startAssessment(assessmentId);
      
      const startData = startResponse.data || startResponse;
      setSubmission(startData);

      // Load existing answers from server if resuming
      if (startData.id || startData.submissionId) {
        try {
          const submissionId = startData.id || startData.submissionId;
          
          // CRITICAL FIX: Try to load from sessionStorage first (faster, decrypt if encrypted)
          const sessionKey = `assessment_answers_${submissionId}`;
          const cachedAnswers = sessionStorage.getItem(sessionKey);
          if (cachedAnswers) {
            try {
              let parsed;
              // Try to decrypt first (new encrypted format)
              try {
                parsed = await encryptionService.decrypt(cachedAnswers);
              } catch (decryptError) {
                // Fallback: try parsing as plain JSON (backward compatibility)
                parsed = JSON.parse(cachedAnswers);
              }
              
              if (parsed.timestamp && Date.now() - parsed.timestamp < 300000) { // 5 minutes cache
                setAnswers(parsed.answers || {});
                // Restore time spent if available
                if (parsed.timeSpent) {
                  setTimeSpent(parsed.timeSpent);
                }
                // Still fetch from server in background to sync
              }
            } catch (e) {
              logger.error('Error parsing cached answers:', e);
            }
          }
          
          // Load from server
          const token = localStorage.getItem('token') || localStorage.getItem('lmsToken');
          const { getApiBaseUrl } = await import('../../utils/apiConfig');
          const apiBaseUrl = getApiBaseUrl();
          const answersResponse = await fetch(`${apiBaseUrl}/student-assessments/${submissionId}/answers`, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          });
          
          if (answersResponse.ok) {
            // Check if response is actually JSON
            const contentType = answersResponse.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
              logger.error('Response is not JSON:', contentType);
              throw new Error('Invalid response format from server');
            }
            
            const answersData = await answersResponse.json();
            if (answersData.data && Array.isArray(answersData.data)) {
              const loadedAnswers = {};
              const loadedTimeSpent = {};
              
              answersData.data.forEach(response => {
                if (response.answer !== null && response.answer !== undefined) {
                  try {
                    // Parse JSON answers if needed
                    const parsedAnswer = typeof response.answer === 'string' 
                      ? JSON.parse(response.answer) 
                      : response.answer;
                    loadedAnswers[response.question_id] = parsedAnswer;
                    
                    // Restore time spent (convert from seconds to milliseconds)
                    if (response.time_spent !== null && response.time_spent !== undefined) {
                      loadedTimeSpent[response.question_id] = (response.time_spent || 0) * 1000;
                    }
                    
                    // Restore code editor state for coding questions
                    if (parsedAnswer.code && parsedAnswer.language && typeof Storage !== 'undefined') {
                      const codeKey = `code_${response.question_id}`;
                      const codeByLang = { [parsedAnswer.language]: parsedAnswer.code };
                      localStorage.setItem(codeKey, JSON.stringify(codeByLang));
                    }
                  } catch (e) {
                    // If not JSON, use as-is
                    loadedAnswers[response.question_id] = response.answer;
                    
                    // Still restore time spent
                    if (response.time_spent !== null && response.time_spent !== undefined) {
                      loadedTimeSpent[response.question_id] = (response.time_spent || 0) * 1000;
                    }
                  }
                }
              });
              
              setAnswers(loadedAnswers);
              setTimeSpent(prev => ({ ...prev, ...loadedTimeSpent }));
              
              // CRITICAL FIX: Cache in sessionStorage with encryption
              if (typeof Storage !== 'undefined') {
                const dataToStore = {
                  answers: loadedAnswers,
                  timeSpent: loadedTimeSpent,
                  timestamp: Date.now()
                };
                
                encryptionService.encrypt(dataToStore)
                  .then(encryptedData => {
                    sessionStorage.setItem(sessionKey, encryptedData);
                  })
                  .catch(encryptError => {
                    logger.error('Error encrypting session data:', encryptError);
                    // Fallback: store without encryption if encryption fails
                    sessionStorage.setItem(sessionKey, JSON.stringify(dataToStore));
                  });
              }
            }
          }
        } catch (error) {
          logger.error('Error loading existing answers:', error);
          // Don't block assessment if answer loading fails
        }
      }

      // DO NOT initialize proctoring here - it will start when question-taking begins
      // Proctoring will be initialized when reaching the 'questions' step

      // Mark description step as completed
      setCompletedSteps(prev => new Set([...prev, 'description']));

    } catch (error) {
      logger.error('Error initializing assessment:', error);
      setError(error.message || 'Failed to initialize assessment');
      toast.error('Failed to load assessment');
    } finally {
      setLoading(false);
    }
  };

  const initializeProctoring = async () => {
    if (proctoringRef.current && assessment?.proctoring_settings) {
      try {
        // Check if permissions are granted for required features
        const settings = assessment.proctoring_settings || {};
        
        // Request permissions if needed
        if (settings.require_webcam && !proctoringPermissions.camera) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            stream.getTracks().forEach(track => track.stop()); // Stop immediately, ProctoringMonitor will request again
            setProctoringPermissions(prev => ({ ...prev, camera: true }));
          } catch (error) {
            logger.error('Camera permission denied:', error);
            toast.error('Camera permission is required for proctoring');
          }
        }
        
        if (settings.require_microphone && !proctoringPermissions.microphone) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop()); // Stop immediately
            setProctoringPermissions(prev => ({ ...prev, microphone: true }));
          } catch (error) {
            logger.error('Microphone permission denied:', error);
            toast.error('Microphone permission is required for proctoring');
          }
        }
        
        // Initialize proctoring monitor
        if (proctoringRef.current.initialize) {
          proctoringRef.current.initialize();
        }
      } catch (error) {
        logger.error('Error initializing proctoring:', error);
        toast.error('Failed to initialize proctoring monitoring');
      }
    }
  };

  // CRITICAL FIX: Cleanup all timeouts and intervals on unmount
  useEffect(() => {
    return () => {
      // Clear all debounce timeouts
      Object.values(debounceTimeouts.current).forEach(timeout => {
        if (timeout) clearTimeout(timeout);
      });
      debounceTimeouts.current = {};
      
      // Clear all active timeouts
      activeTimeoutsRef.current.forEach(timeout => {
        if (timeout) clearTimeout(timeout);
      });
      activeTimeoutsRef.current = [];
      
      // Clear auto-save interval
      if (autoSaveInterval.current) {
        clearInterval(autoSaveInterval.current);
        autoSaveInterval.current = null;
      }
      
      // Clear sync interval
      // (syncInterval is already cleaned up in its useEffect)
    };
  }, []);
  
  const handleAnswerChange = (questionId, answer) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: answer
    }));
    
    // Debounced save - save 1 second after user stops typing
    if (debounceTimeouts.current[questionId]) {
      clearTimeout(debounceTimeouts.current[questionId]);
    }
    
    debounceTimeouts.current[questionId] = setTimeout(() => {
      if (submission) {
        saveAnswer(questionId, answer, false);
      }
      delete debounceTimeouts.current[questionId];
    }, 1000); // 1 second debounce (reduced from 2.5s)
  };

  const saveAnswer = async (questionId, answer, immediate = false) => {
    if (!submission) return;
    
    // Allow empty answers - don't block save (validation happens on submission)
    // Only skip if answer is explicitly null or undefined
    if (answer === null || answer === undefined) {
      return;
    }

    // If offline, queue for later
    if (!isOnline) {
      setOfflineQueue(prev => {
        // Remove existing entry for this question
        const filtered = prev.filter(item => item.questionId !== questionId);
        // Add new entry
        return [...filtered, {
          questionId,
          answer,
          timeSpent: Math.floor((timeSpent[questionId] || 0) / 1000),
          timestamp: Date.now()
        }];
      });
      
      // CRITICAL FIX: Store in localStorage as backup with encryption
      if (typeof Storage !== 'undefined') {
        const submissionId = submission.id || submission.submissionId;
        const offlineKey = `offline_answer_${submissionId}_${questionId}`;
        
        // Encrypt sensitive assessment data before storing
        const dataToStore = {
          questionId,
          answer,
          timeSpent: Math.floor((timeSpent[questionId] || 0) / 1000),
          timestamp: Date.now()
        };
        
        try {
          const encryptedData = await encryptionService.encrypt(dataToStore);
          localStorage.setItem(offlineKey, encryptedData);
        } catch (encryptError) {
              logger.error('Error encrypting offline answer:', encryptError);
          // Fallback: store without encryption if encryption fails (shouldn't happen)
          localStorage.setItem(offlineKey, JSON.stringify(dataToStore));
        }
      }
      
      if (immediate) {
        toast.warning('Answer queued for saving (offline)');
      }
      return;
    }

    try {
      const timeSpentOnQuestion = timeSpent[questionId] || 0;
      
      await apiService.saveAnswer(submission.id || submission.submissionId, {
        questionId,
        answer,
        timeSpent: Math.floor(timeSpentOnQuestion / 1000) // Convert to seconds
      });

      // Remove from offline queue if it was there
      setOfflineQueue(prev => prev.filter(item => item.questionId !== questionId));
      
      // Remove from localStorage
      if (typeof Storage !== 'undefined') {
        const submissionId = submission.id || submission.submissionId;
        const offlineKey = `offline_answer_${submissionId}_${questionId}`;
        localStorage.removeItem(offlineKey);
      }

      if (immediate) {
        toast.success('Answer saved');
      }
    } catch (error) {
            logger.error('Error saving answer:', error);
      
      // If network error, queue for later
      if (!navigator.onLine || error.message.includes('fetch') || error.message.includes('network')) {
        setOfflineQueue(prev => {
          const filtered = prev.filter(item => item.questionId !== questionId);
          return [...filtered, {
            questionId,
            answer,
            timeSpent: Math.floor((timeSpent[questionId] || 0) / 1000),
            timestamp: Date.now()
          }];
        });
        
        if (immediate) {
          toast.warning('Answer queued for saving (offline)');
        }
      } else if (immediate) {
        toast.error('Failed to save answer');
      }
    }
  };

  const autoSave = async () => {
    if (!submission) return;

    setSaving(true);
    const failedSaves = [];
    const submissionId = submission.id || submission.submissionId;
    
    try {
      // Collect all answers from state
      const allAnswersToSave = { ...answers };
      
      // Also check localStorage for any offline answers that might not be in state
      if (typeof Storage !== 'undefined') {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(`offline_answer_${submissionId}_`)) {
            try {
              const storedData = localStorage.getItem(key);
              let stored;
              
              // CRITICAL FIX: Try to decrypt first (new encrypted format)
              try {
                stored = await encryptionService.decrypt(storedData);
              } catch (decryptError) {
                // Fallback: try parsing as plain JSON (backward compatibility)
                stored = JSON.parse(storedData);
              }
              
              if (stored && stored.questionId && stored.answer !== undefined && stored.answer !== null) {
                // Merge with state answers (state takes precedence)
                if (!allAnswersToSave[stored.questionId]) {
                  allAnswersToSave[stored.questionId] = stored.answer;
                }
              }
            } catch (e) {
              logger.error('Error parsing stored answer:', e);
            }
          }
        }
      }
      
      // Also check sessionStorage
      if (typeof Storage !== 'undefined') {
        const sessionKey = `assessment_answers_${submissionId}`;
        const cached = sessionStorage.getItem(sessionKey);
        if (cached) {
          try {
            // CRITICAL FIX: Try to decrypt first (encrypted format), then fallback to plain JSON
            let parsed;
            try {
              parsed = await encryptionService.decrypt(cached);
            } catch (decryptError) {
              // Fallback: try parsing as plain JSON (backward compatibility)
              parsed = JSON.parse(cached);
            }
            
            if (parsed && parsed.answers) {
              // Merge sessionStorage answers (state takes precedence)
              Object.entries(parsed.answers).forEach(([qId, ans]) => {
                if (!allAnswersToSave[qId] && ans !== undefined && ans !== null) {
                  allAnswersToSave[qId] = ans;
                }
              });
            }
            // Also merge timeSpent from sessionStorage
            if (parsed && parsed.timeSpent) {
              Object.entries(parsed.timeSpent).forEach(([qId, time]) => {
                if (!timeSpent[qId] && time) {
                  setTimeSpent(prev => ({ ...prev, [qId]: time }));
                }
              });
            }
          } catch (e) {
            logger.error('Error parsing sessionStorage answers:', e);
          }
        }
      }
      
      // MEDIUM FIX: Batch saves to improve performance with large assessments
      const BATCH_SIZE = 10; // Save 10 answers at a time
      const answerEntries = Object.entries(allAnswersToSave).filter(
        ([_, answer]) => answer !== null && answer !== undefined
      );
      
      // Process in batches to avoid blocking UI
      for (let i = 0; i < answerEntries.length; i += BATCH_SIZE) {
        const batch = answerEntries.slice(i, i + BATCH_SIZE);
        
        // Save batch in parallel (Promise.all)
        const batchPromises = batch.map(async ([questionId, answer]) => {
          try {
            const questionTimeSpent = timeSpent[questionId] || 0;
            await apiService.saveAnswer(submissionId, {
              questionId,
              answer,
              timeSpent: Math.floor(questionTimeSpent / 1000) // Convert to seconds
            });
            return { questionId, success: true };
          } catch (error) {
            logger.error(`Failed to save answer for question ${questionId}:`, error);
            return { questionId, success: false };
          }
        });
        
        // Wait for batch to complete
        const batchResults = await Promise.all(batchPromises);
        
        // Track failures
        batchResults.forEach(result => {
          if (!result.success) {
            failedSaves.push(result.questionId);
          }
        });
        
        // Small delay between batches to prevent overwhelming the server
        if (i + BATCH_SIZE < answerEntries.length) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      
      // Also sync offline queue
      if (offlineQueue.length > 0) {
        await syncOfflineQueue();
      }
      
      if (failedSaves.length === 0) {
        toast.success('Auto-saved', { duration: 2000 });
      } else {
        toast.error(`Failed to save ${failedSaves.length} answer${failedSaves.length > 1 ? 's' : ''}`, { duration: 3000 });
      }
    } catch (error) {
      logger.error('Auto-save error:', error);
      toast.error('Auto-save error');
    } finally {
      setSaving(false);
    }
  };

  const flagQuestion = (questionId) => {
    setFlaggedQuestions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(questionId)) {
        newSet.delete(questionId);
        toast.success('Question unflagged');
      } else {
        newSet.add(questionId);
        toast.success('Question flagged for review');
      }
      return newSet;
    });
  };

  const navigateToQuestion = (index) => {
    if (index >= 0 && index < questions.length) {
      setCurrentQuestionIndex(index);
    }
  };

  const navigateToSection = async (index) => {
    if (index >= 0 && index < sections.length) {
      // Prevent multiple simultaneous navigations
      if (isNavigatingRef.current) {
        return;
      }
      
      isNavigatingRef.current = true;
      
      // Save ALL answers before navigation - including from all sections
      try {
        setSaving(true);
        // Clear any pending debounced saves and save immediately
        Object.values(debounceTimeouts.current).forEach(timeout => clearTimeout(timeout));
        debounceTimeouts.current = {};
        
        // Save current question time before navigating
        if (questions[currentQuestionIndex]) {
          const questionId = questions[currentQuestionIndex].id;
          if (questionStartTime.current) {
            const timeSpentOnQuestion = Date.now() - questionStartTime.current;
            setTimeSpent(prev => ({
              ...prev,
              [questionId]: (prev[questionId] || 0) + timeSpentOnQuestion
            }));
            questionStartTime.current = Date.now(); // Reset for next question
          }
        }
        
        // Save all answers from all sections
        await autoSave();
        
        // CRITICAL FIX: Track timeout for cleanup
        await new Promise(resolve => {
          const timeoutId = setTimeout(resolve, 1000);
          activeTimeoutsRef.current.push(timeoutId);
          setTimeout(() => {
            activeTimeoutsRef.current = activeTimeoutsRef.current.filter(id => id !== timeoutId);
          }, 1100);
        });
      } catch (error) {
        logger.error('Error saving before navigation:', error);
        toast.error('Failed to save answers. Please try again.');
        isNavigatingRef.current = false;
        return; // Don't navigate if save fails
      } finally {
        setSaving(false);
      }
      
      setCurrentSectionIndex(index);
      // Find first question in the section
      const sectionQuestions = questions.filter(q => q.section_id === sections[index].id);
      if (sectionQuestions.length > 0) {
        const firstQuestionIndex = questions.findIndex(q => q.id === sectionQuestions[0].id);
        setCurrentQuestionIndex(firstQuestionIndex);
      }
      
      isNavigatingRef.current = false;
    }
  };

  const handleStepComplete = async (stepId) => {
    // Prevent multiple simultaneous step completions
    if (isNavigatingRef.current) {
      return;
    }
    
    isNavigatingRef.current = true;
    
    // Save ALL answers before moving to next step - including all sections
    try {
      setSaving(true);
      // Clear any pending debounced saves and save immediately
      Object.values(debounceTimeouts.current).forEach(timeout => clearTimeout(timeout));
      debounceTimeouts.current = {};
      
      // Save current question time before step change
      if (questions[currentQuestionIndex]) {
        const questionId = questions[currentQuestionIndex].id;
        if (questionStartTime.current) {
          const timeSpentOnQuestion = Date.now() - questionStartTime.current;
          setTimeSpent(prev => ({
            ...prev,
            [questionId]: (prev[questionId] || 0) + timeSpentOnQuestion
          }));
          questionStartTime.current = Date.now(); // Reset for next question
        }
      }
      
      // Save all answers from all sections
      await autoSave();
      
      // CRITICAL FIX: Track timeout for cleanup
      await new Promise(resolve => {
        const timeoutId = setTimeout(resolve, 1000);
        activeTimeoutsRef.current.push(timeoutId);
        setTimeout(() => {
          activeTimeoutsRef.current = activeTimeoutsRef.current.filter(id => id !== timeoutId);
        }, 1100);
      });
    } catch (error) {
      logger.error('Error saving before step completion:', error);
      toast.error('Failed to save answers. Please try again.');
      isNavigatingRef.current = false;
      return; // Don't proceed if save fails
    } finally {
      setSaving(false);
    }
    
    setCompletedSteps(prev => new Set([...prev, stepId]));
    
    // Move to next step
    const currentIndex = steps.findIndex(step => step.id === stepId);
    if (currentIndex < steps.length - 1) {
      const nextStep = steps[currentIndex + 1];
      
      // Update currentSectionIndex if moving to a section-specific step
      if (nextStep?.sectionIndex !== undefined) {
        setCurrentSectionIndex(nextStep.sectionIndex);
        
        // If moving to a questions step, also update currentQuestionIndex to first question of that section
        if (nextStep.stepType === 'questions') {
          const sectionQuestions = questions.filter(q => q.section_id === sections[nextStep.sectionIndex]?.id);
          if (sectionQuestions.length > 0) {
            const firstQuestionIndex = questions.findIndex(q => q.id === sectionQuestions[0].id);
            if (firstQuestionIndex >= 0) {
              setCurrentQuestionIndex(firstQuestionIndex);
            }
          }
        }
      }
      
      setCurrentStep(currentIndex + 1);
    }
    
    isNavigatingRef.current = false;
  };

  const handleStepBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleCancel = () => {
    if (window.confirm('Are you sure you want to cancel? Your progress will be lost.')) {
      navigate('/student/assessments');
    }
  };

  const handleSubmitAssessment = async () => {
    try {
      setSaving(true);
      
      // Save current question time before submission
      if (questions[currentQuestionIndex]) {
        const questionId = questions[currentQuestionIndex].id;
        if (questionStartTime.current) {
          const timeSpentOnQuestion = Date.now() - questionStartTime.current;
          setTimeSpent(prev => ({
            ...prev,
            [questionId]: (prev[questionId] || 0) + timeSpentOnQuestion
          }));
        }
      }
      
      // CRITICAL: Save ALL answers from ALL sections before submission
      // This includes answers from state, localStorage, and sessionStorage
      await autoSave();
      
      // Also sync any offline queue
      if (offlineQueue.length > 0) {
        await syncOfflineQueue();
      }
      
      // Wait longer to ensure all saves complete
      await new Promise(resolve => setTimeout(resolve, 1000)); // Reduced from 2000ms
      
      // Double-check: Save any remaining answers that might not have been saved
      const submissionId = submission.id || submission.submissionId;
      const allAnswersToSave = { ...answers };
      
      // CRITICAL FIX: Collect from localStorage (decrypt if encrypted)
      if (typeof Storage !== 'undefined') {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(`offline_answer_${submissionId}_`)) {
            try {
              const storedData = localStorage.getItem(key);
              let stored;
              
              // Try to decrypt first (new encrypted format)
              try {
                stored = await encryptionService.decrypt(storedData);
              } catch (decryptError) {
                // Fallback: try parsing as plain JSON (backward compatibility)
                stored = JSON.parse(storedData);
              }
              
              if (stored && stored.questionId && stored.answer !== undefined && stored.answer !== null) {
                allAnswersToSave[stored.questionId] = stored.answer;
              }
            } catch (e) {
              logger.error('Error parsing stored answer:', e);
            }
          }
        }
      }
      
      // Final save of any remaining answers
      for (const [questionId, answer] of Object.entries(allAnswersToSave)) {
        if (answer !== null && answer !== undefined) {
          try {
            const questionTimeSpent = timeSpent[questionId] || 0;
            await apiService.saveAnswer(submissionId, {
              questionId,
              answer,
              timeSpent: Math.floor(questionTimeSpent / 1000)
            });
          } catch (error) {
            logger.error(`Final save failed for question ${questionId}:`, error);
            // Continue even if some fail
          }
        }
      }
      
      // CRITICAL FIX: Track timeout for cleanup
      await new Promise(resolve => {
        const timeoutId = setTimeout(resolve, 1000);
        activeTimeoutsRef.current.push(timeoutId);
        setTimeout(() => {
          activeTimeoutsRef.current = activeTimeoutsRef.current.filter(id => id !== timeoutId);
        }, 1100);
      });
      
      // Submit assessment - this will mark the attempt as completed
      // Pass all answers and timeSpent as a final safety net
      const result = await apiService.submitAssessment(submissionId, {
        deviceInfo: {
          userAgent: navigator.userAgent,
          screenResolution: `${screen.width}x${screen.height}`,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        },
        // Pass all answers and timeSpent as final safety save
        answers: allAnswersToSave,
        timeSpent: timeSpent
      });

      toast.success('Assessment submitted successfully! All answers have been saved.');
      
      // Clear localStorage and sessionStorage after successful submission
      if (typeof Storage !== 'undefined') {
        // Clear offline answers
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (key && key.startsWith(`offline_answer_${submissionId}_`)) {
            localStorage.removeItem(key);
          }
        }
        // Clear session storage
        sessionStorage.removeItem(`assessment_answers_${submissionId}`);
        sessionStorage.removeItem('assessment-timer-session');
        sessionStorage.removeItem('assessment-timer-session-start');
        sessionStorage.removeItem('assessment-timer-session-duration');
      }
      
      // Move to results step if immediate results are enabled
      if (assessment.show_results_immediately) {
        handleStepComplete('submission');
      } else {
        // Navigate to assessment list or results page
        navigate(`/student/assessments/${assessmentId}/results`);
      }
    } catch (error) {
      logger.error('Error submitting assessment:', error);
      toast.error(error.message || 'Failed to submit assessment. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleTimeUp = async () => {
    toast.error('Time is up! Assessment will be auto-submitted.');
    try {
      // Save current question time
      if (questions[currentQuestionIndex]) {
        const questionId = questions[currentQuestionIndex].id;
        if (questionStartTime.current) {
          const timeSpentOnQuestion = Date.now() - questionStartTime.current;
          setTimeSpent(prev => ({
            ...prev,
            [questionId]: (prev[questionId] || 0) + timeSpentOnQuestion
          }));
        }
      }
      
      // CRITICAL: Ensure ALL answers are saved before auto-submitting
      await autoSave();
      
      // Sync offline queue
      if (offlineQueue.length > 0) {
        await syncOfflineQueue();
      }
      
      // Wait longer to ensure all saves complete
      await new Promise(resolve => setTimeout(resolve, 1000)); // Reduced from 2000ms
      
      // Final save of any remaining answers
      const submissionId = submission.id || submission.submissionId;
      const allAnswersToSave = { ...answers };
      
      if (typeof Storage !== 'undefined') {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(`offline_answer_${submissionId}_`)) {
            try {
              const stored = JSON.parse(localStorage.getItem(key));
              if (stored && stored.questionId && stored.answer !== undefined && stored.answer !== null) {
                allAnswersToSave[stored.questionId] = stored.answer;
                const questionTimeSpent = timeSpent[stored.questionId] || stored.timeSpent * 1000 || 0;
                await apiService.saveAnswer(submissionId, {
                  questionId: stored.questionId,
                  answer: stored.answer,
                  timeSpent: Math.floor(questionTimeSpent / 1000)
                });
              }
            } catch (e) {
              logger.error('Error parsing stored answer:', e);
            }
          }
        }
      }
      
      // CRITICAL FIX: Track timeout for cleanup
      await new Promise(resolve => {
        const timeoutId = setTimeout(resolve, 1000);
        activeTimeoutsRef.current.push(timeoutId);
        setTimeout(() => {
          activeTimeoutsRef.current = activeTimeoutsRef.current.filter(id => id !== timeoutId);
        }, 1100);
      });
      
      // Now submit
      await handleSubmitAssessment();
    } catch (error) {
      console.error('Error in auto-submit on time up:', error);
      // Try to submit anyway even if save failed - at least the attempt will be marked as submitted
      try {
        await handleSubmitAssessment();
      } catch (submitError) {
        console.error('Error in final submission attempt:', submitError);
        toast.error('Failed to auto-submit. Please contact support.');
      }
    }
  };

  const getProgressPercentage = () => {
    if (questions.length === 0) return 0;
    return ((currentQuestionIndex + 1) / questions.length) * 100;
  };

  const getAnsweredCount = () => {
    return Object.keys(answers).length;
  };

  const getFlaggedCount = () => {
    return flaggedQuestions.size;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading assessment...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Error Loading Assessment</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <Button onClick={() => navigate('/student/assessments')}>
            Back to Assessments
          </Button>
        </div>
      </div>
    );
  }

  if (!assessment || !submission) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Assessment Not Found</h2>
          <p className="text-gray-600 mb-4">The assessment you're looking for doesn't exist or you don't have access to it.</p>
          <Button onClick={() => navigate('/student/assessments')}>
            Back to Assessments
          </Button>
        </div>
      </div>
    );
  }

  // Render current step component
  const renderStepContent = () => {
    if (!currentStepData) return null;
    
    const StepComponent = currentStepData.component;
    
    const commonProps = {
      assessment,
      submission,
      questions,
      sections,
      answers,
      setAnswers: handleAnswerChange,
      currentQuestionIndex,
      setCurrentQuestionIndex: navigateToQuestion,
      currentSectionIndex,
      setCurrentSectionIndex: navigateToSection,
      timeSpent,
      flaggedQuestions,
      flagQuestion,
      saveAnswer,
      saving,
      onComplete: () => handleStepComplete(currentStepData.id),
      onBack: handleStepBack,
      onCancel: handleCancel,
      onSubmit: handleSubmitAssessment,
      onTimeUp: handleTimeUp,
      proctoringEnabled,
      proctoringPermissions,
      setProctoringPermissions,
      proctoringViolations,
      setProctoringViolations,
      isRetake,
      onShowSidebar: showSidebar,
      setShowSidebar: setShowSidebar,
      theme: theme,
      isDarkMode: isDarkMode,
      timerRef: timerRef
    };

    // Handle section-specific steps
    if (currentStepData.stepType === 'section-start') {
      const section = sections[currentStepData.sectionIndex];
      return (
        <StepComponent
          {...commonProps}
          section={section}
          sectionIndex={currentStepData.sectionIndex}
          totalSections={sections.length}
          onStart={() => {
            // Update section index before moving to questions
            setCurrentSectionIndex(currentStepData.sectionIndex);
            handleStepComplete(currentStepData.id);
          }}
        />
      );
    }

    if (currentStepData.stepType === 'section-completion') {
      const section = sections[currentStepData.sectionIndex];
      const sectionQuestions = questions.filter(q => q.section_id === section.id);
      return (
        <StepComponent
          {...commonProps}
          section={section}
          sectionIndex={currentStepData.sectionIndex}
          totalSections={sections.length}
          sectionQuestions={sectionQuestions}
          isSavingBeforeContinue={saving}
          saving={saving}
          onContinue={() => {
            handleStepComplete(currentStepData.id);
          }}
          onBack={() => {
            // Go back to section questions
            const questionsStepIndex = steps.findIndex(s => s.id === `section-questions-${currentStepData.sectionIndex}`);
            if (questionsStepIndex >= 0) {
              setCurrentSectionIndex(currentStepData.sectionIndex);
              setCurrentStep(questionsStepIndex);
            }
          }}
          onNavigateToQuestion={(questionIndex, sectionIndex) => {
            // Navigate to the specific question in the section
            const questionsStepIndex = steps.findIndex(s => s.id === `section-questions-${sectionIndex}`);
            if (questionsStepIndex >= 0) {
              setCurrentSectionIndex(sectionIndex);
              setCurrentStep(questionsStepIndex);
              // Find the global question index
              const sectionQ = questions.filter(q => q.section_id === sections[sectionIndex].id);
              if (sectionQ[questionIndex]) {
                const globalIndex = questions.findIndex(q => q.id === sectionQ[questionIndex].id);
                if (globalIndex >= 0) {
                  setCurrentQuestionIndex(globalIndex);
                }
              }
            }
          }}
        />
      );
    }

    // For question taking step with sections
    if (currentStepData.stepType === 'questions' && currentStepData.sectionIndex !== undefined) {
      // Ensure currentSectionIndex matches the step's section
      if (currentSectionIndex !== currentStepData.sectionIndex) {
        setCurrentSectionIndex(currentStepData.sectionIndex);
      }
      
      return (
        <StepComponent
          {...commonProps}
          onSectionComplete={() => {
            // Move to section completion step
            const completionStepIndex = steps.findIndex(s => s.id === `section-completion-${currentStepData.sectionIndex}`);
            if (completionStepIndex >= 0) {
              setCurrentStep(completionStepIndex);
            }
          }}
        />
      );
    }

    return <StepComponent {...commonProps} />;
  };

  // Only show proctoring monitor when in question-taking step
  const isQuestionStep = currentStepData?.stepType === 'questions' || steps.findIndex(step => step.id === 'questions') === currentStep;
  
  // Show header for all assessment-taking steps (questions, section-start, section-completion)
  // but not for initial setup steps (description, terms, proctoring) or results
  const shouldShowHeader = isQuestionStep || 
    currentStepData?.stepType === 'section-start' || 
    currentStepData?.stepType === 'section-completion' ||
    (currentStepData?.id && currentStepData.id.startsWith('section-'));

  const isDarkMode = theme === 'dark';

  return (
    <div className={`h-screen flex flex-col overflow-hidden ${isDarkMode ? 'dark bg-gray-900' : 'bg-gray-50'}`}>
      {/* Proctoring Monitor - Only active during question-taking step */}
      {proctoringEnabled && isQuestionStep && submission && assessment?.proctoring_settings && (
        <ProctoringMonitor
          ref={proctoringRef}
          submissionId={submission.id || submission.submissionId}
          proctoringSettings={assessment.proctoring_settings || {}}
          onViolation={(violation) => {
            // LOW FIX: Use centralized logger
            logger.debug('Proctoring violation:', violation);
            setProctoringViolations(prev => [...prev, violation]);
            // Update tab switch count if it's a tab switch violation
            if (violation.type === 'tab_switch' || violation.type === 'window_blur') {
              setTabSwitchCount(prev => prev + 1);
            }
            toast.error(`Proctoring violation: ${violation.description || violation.type}`, {
              duration: 5000
            });
          }}
        />
      )}

      {/* Single Merged Header - Show for all assessment-taking steps (questions, section-start, section-completion) */}
      {shouldShowHeader && (
        <div className="bg-white shadow-sm border-b flex-shrink-0 z-40">
          <div className="px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16 gap-4">
              {/* Left: Test Name */}
              <div className="flex items-center gap-4 min-w-0 flex-1">
                <h1 className="text-lg font-semibold text-gray-900 truncate">
                  {assessment?.title || 'Assessment'}
              </h1>
              </div>

              {/* Center: Timer, Auto-Save, Proctor */}
              <div className="flex items-center gap-4 flex-shrink-0">
                {/* Timer */}
                <TimerComponent
                  key="assessment-timer" // Keep same key to prevent remounting
                  ref={timerRef}
                  duration={assessment?.time_limit_minutes ? assessment.time_limit_minutes * 60 : 3600}
                  onTimeUp={handleTimeUp}
                  className="text-base font-mono"
                  submissionId={submission?.id || submission?.submissionId}
                />

                {/* Auto-Save Status */}
                {saving ? (
                  <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Saving...</span>
                  </div>
                ) : !isOnline ? (
                  <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                    <WifiOff className="h-4 w-4" />
                    <span className="text-sm">Offline</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                    <Wifi className="h-4 w-4" />
                    <span className="text-sm">Saved</span>
                  </div>
                )}

                {/* Proctor Status */}
                {proctoringEnabled && (
                  <Badge className={`${
                    proctoringViolations.length > 0 
                      ? 'text-orange-600 bg-orange-50 border-orange-200' 
                      : 'text-green-600 bg-green-50 border-green-200'
                  } border`}>
                    <Eye className="h-3 w-3 mr-1" />
                    {proctoringViolations.length > 0 
                      ? `Flagged (${proctoringViolations.length})` 
                      : 'Live'}
                  </Badge>
                )}
            </div>
            
              {/* Right: Tab Switch Count, Theme Toggle & Submit */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Tab Switch Count - Only show if tab switching detection is enabled */}
                {proctoringEnabled && 
                 assessment?.proctoring_settings?.tab_switching_detection && (
                  <div className="flex items-center space-x-1 px-2 py-1 bg-orange-50 border border-orange-200 rounded-md">
                    <span className="text-xs font-medium text-orange-700">
                      Tab Switches:
                    </span>
                    <Badge 
                      variant="outline" 
                      className="bg-orange-100 text-orange-700 border-orange-300 font-semibold"
                      title="Number of times you switched tabs or lost window focus"
                    >
                      {tabSwitchCount}
                    </Badge>
                  </div>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  className="h-8 w-8 p-0"
                  title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                >
                  {theme === 'dark' ? (
                    <Sun className="h-4 w-4 text-gray-300" />
                  ) : (
                    <Moon className="h-4 w-4 text-gray-600" />
                  )}
                </Button>
                <Button
                  onClick={handleSubmitAssessment}
                  className="bg-green-600 hover:bg-green-700 text-white relative"
                  size="sm"
                >
                  <CheckCircle className="h-4 w-4 mr-1" />
                  Submit
                  {proctoringViolations.length > 0 && (
                    <Badge 
                      variant="destructive" 
                      className="ml-2 bg-red-600 hover:bg-red-700 text-white"
                      title={`${proctoringViolations.length} proctoring violation${proctoringViolations.length > 1 ? 's' : ''} detected`}
                    >
                      {proctoringViolations.length}
                    </Badge>
                  )}
              </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Proctoring Violation Warning Banner */}
      {shouldShowHeader && proctoringEnabled && proctoringViolations.length > 0 && (
        <Alert variant="destructive" className="mx-4 mt-2 mb-0 z-30">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Warning:</strong> {proctoringViolations.length} proctoring violation{proctoringViolations.length > 1 ? 's' : ''} detected during your assessment. 
            {proctoringViolations.length >= 3 && (
              <span className="font-semibold"> Multiple violations may result in disqualification.</span>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Main Content */}
      {isQuestionStep ? (
        <div className="flex-1 overflow-hidden min-h-0">
          {renderStepContent()}
        </div>
      ) : (
        <>
          {currentStepData?.id === 'terms' || currentStepData?.stepType === 'section-start' || currentStepData?.stepType === 'section-completion' ? (
            // Terms, section start, and section completion steps take full viewport
            <div className="flex-1 overflow-hidden min-h-0">
              {renderStepContent()}
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto min-h-0">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
          >
            {renderStepContent()}
          </motion.div>
        </AnimatePresence>
      </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default AssessmentTakeWizard;
