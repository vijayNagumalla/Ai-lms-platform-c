import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle,
  DialogTrigger 
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  Building, 
  Building2,
  Plus, 
  Search, 
  Edit, 
  Trash2, 
  Eye, 
  Users, 
  BookOpen, 
  Loader2,
  Mail,
  Phone,
  Globe,
  MapPin,
  Filter,
  Calendar,
  Award,
  User,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  QrCode,
  Download,
  Share2,
  X
} from 'lucide-react';
import { motion } from 'framer-motion';
import apiService from '@/services/api';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';

const CollegeManagementPage = () => {
  const { user } = useAuth();
  const [colleges, setColleges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isContactPersonDialogOpen, setIsContactPersonDialogOpen] = useState(false);
  const [isStudentsDialogOpen, setIsStudentsDialogOpen] = useState(false);
  const [isFacultyDialogOpen, setIsFacultyDialogOpen] = useState(false);
  const [isDepartmentsDialogOpen, setIsDepartmentsDialogOpen] = useState(false);
  const [isBatchesDialogOpen, setIsBatchesDialogOpen] = useState(false);
  const [showAddDepartmentForm, setShowAddDepartmentForm] = useState(false);
  const [showAddBatchForm, setShowAddBatchForm] = useState(false);
  const [editingDepartmentIndex, setEditingDepartmentIndex] = useState(null);
  const [editingBatchIndex, setEditingBatchIndex] = useState(null);
  const [newDepartment, setNewDepartment] = useState({ name: '', code: '', description: '' });
  const [newBatch, setNewBatch] = useState({ name: '', code: '', description: '' });
  const [tempDepartments, setTempDepartments] = useState([]);
  const [tempCustomDepartments, setTempCustomDepartments] = useState([]);
  const [tempBatches, setTempBatches] = useState([]);
  const [selectedCollege, setSelectedCollege] = useState(null);
  const [isViewStudentsDialogOpen, setIsViewStudentsDialogOpen] = useState(false);
  const [viewStudentsData, setViewStudentsData] = useState({ type: '', name: '', students: [] });
  const [departmentStudentCounts, setDepartmentStudentCounts] = useState({});
  const [batchStudentCounts, setBatchStudentCounts] = useState({});
  const [viewStudentsPagination, setViewStudentsPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0
  });
  const [locations, setLocations] = useState([]);
  const [filters, setFilters] = useState({
    city: '',
    state: '',
    country: '',
    is_active: ''
  });
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0
  });
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    country: 'India',
    postal_code: '',
    website: '',
    logo_url: '',
    established_year: '',
    accreditation: '',
    description: ''
  });

  const [contactPersons, setContactPersons] = useState([
    { name: '', phone: '', email: '', designation: '' }
  ]);

  const [departments, setDepartments] = useState([]);

  const [customDepartments, setCustomDepartments] = useState([
    { name: '', code: '', description: '' }
  ]);
  const [formErrors, setFormErrors] = useState({});
  const { toast } = useToast();
  const [students, setStudents] = useState([]);
  const [faculty, setFaculty] = useState([]);
  const [studentSearch, setStudentSearch] = useState('');
  const [facultySearch, setFacultySearch] = useState('');
  const [studentPage, setStudentPage] = useState(1);
  const [facultyPage, setFacultyPage] = useState(1);
  const [studentTotal, setStudentTotal] = useState(0);
  const [facultyTotal, setFacultyTotal] = useState(0);
  const studentsPerPage = 10;
  const facultyPerPage = 10;
  const navigate = useNavigate();

  // Contact sharing state
  const [emailRecipient, setEmailRecipient] = useState('');
  const [whatsappRecipient, setWhatsappRecipient] = useState('');
  const [showEmailInput, setShowEmailInput] = useState(false);
  const [showWhatsappInput, setShowWhatsappInput] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [activeContact, setActiveContact] = useState(null);
  const [showQRCode, setShowQRCode] = useState(false);



  useEffect(() => {
    if (user && user.role === 'super-admin') {
      fetchColleges();
      fetchLocations();
    } else {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, searchTerm, filters, user]);

  // Fetch department student counts when departments change
  useEffect(() => {
    if (selectedCollege && selectedCollege.departments && selectedCollege.departments.length > 0) {
      fetchDepartmentStudentCounts();
    }
  }, [selectedCollege?.departments]);

  // Fetch batch student counts when batches change
  useEffect(() => {
    if (tempBatches && tempBatches.length > 0) {
      fetchBatchStudentCounts();
    }
  }, [tempBatches]);

  const fetchColleges = async () => {
    try {
      setLoading(true);
      const params = {
        page: pagination.page,
        limit: pagination.limit,
        search: searchTerm,
        ...filters
      };
      
      const response = await apiService.getSuperAdminColleges(params);
      
      if (response.success) {
        setColleges(response.data.colleges);
        setPagination(prev => ({
          ...prev,
          total: response.data.pagination.total,
          totalPages: response.data.pagination.totalPages
        }));
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load colleges"
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchLocations = async () => {
    try {
      const response = await apiService.getSuperAdminCollegeLocations();
      if (response.success) {
        setLocations(response.data || []);
      }
    } catch (error) {
      // Set empty array to prevent frontend errors
      setLocations([]);
    }
  };



  const handleSearch = (e) => {
    e.preventDefault();
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const clearFilters = () => {
    setFilters({
      city: '',
      state: '',
      country: '',
      is_active: ''
    });
    setSearchTerm('');
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  // Contact person management functions
  const addContactPerson = () => {
    setContactPersons([...contactPersons, { name: '', phone: '', email: '', designation: '' }]);
  };

  const removeContactPerson = (index) => {
    if (contactPersons.length > 1) {
      setContactPersons(contactPersons.filter((_, i) => i !== index));
    }
  };

  const updateContactPerson = (index, field, value) => {
    const updated = [...contactPersons];
    updated[index] = { ...updated[index], [field]: value };
    setContactPersons(updated);
  };

  // Department management functions
  const addDepartment = (dept) => {
    if (dept && dept.name && dept.code) {
      setDepartments([...departments, { ...dept, id: Date.now() }]);
    }
  };

  const removeDepartment = (index) => {
    setDepartments(departments.filter((_, i) => i !== index));
  };

  const addCustomDepartment = () => {
    setCustomDepartments([...customDepartments, { name: '', code: '', description: '' }]);
  };

  const removeCustomDepartment = (index) => {
    setCustomDepartments(customDepartments.filter((_, i) => i !== index));
  };

  // Function to generate unique college code from name
  const generateCollegeCode = (name) => {
    if (!name || name.trim() === '') return '';
    
    // Remove special characters and split by spaces
    const cleanName = name.replace(/[^\w\s]/g, '').trim();
    const words = cleanName.split(/\s+/).filter(word => word.length > 0);
    
    if (words.length === 0) return '';
    
    let baseCode = '';
    if (words.length === 1) {
      // Single word: take first 3-4 characters
      const word = words[0];
      if (word.length <= 4) baseCode = word.toUpperCase();
      else baseCode = word.substring(0, 4).toUpperCase();
    } else if (words.length === 2) {
      // Two words: first 2 letters of each word
      const first = words[0].substring(0, 2);
      const second = words[1].substring(0, 2);
      baseCode = (first + second).toUpperCase();
    } else {
      // Multiple words: first letter of first two words + first letter of last word
      const first = words[0].charAt(0);
      const second = words[1].charAt(0);
      const last = words[words.length - 1].charAt(0);
      baseCode = (first + second + last).toUpperCase();
    }
    
    // Check if code already exists and make it unique
    return makeCodeUnique(baseCode);
  };

  // Function to make college code unique by appending numbers if needed
  const makeCodeUnique = (baseCode) => {
    if (!baseCode) return '';
    
    let uniqueCode = baseCode;
    let counter = 1;
    
    // Check if code exists in current colleges list
    while (colleges.some(college => college.code === uniqueCode)) {
      uniqueCode = `${baseCode}${counter}`;
      counter++;
      
      // Prevent infinite loop with a reasonable limit
      if (counter > 100) {
        uniqueCode = `${baseCode}${Date.now().toString().slice(-3)}`;
        break;
      }
    }
    
    return uniqueCode;
  };

  // Function to handle manual code editing attempts
  const handleCodeEditAttempt = () => {
    toast({
      title: "Code is Auto-Generated",
      description: "College codes are automatically generated from the name and cannot be edited manually to ensure uniqueness.",
      variant: "default"
    });
  };

  // Function to generate department code from name
  const generateDepartmentCode = (name) => {
    if (!name || name.trim() === '') return '';
    
    // Remove special characters and split by spaces
    const cleanName = name.replace(/[^\w\s]/g, '').trim();
    const words = cleanName.split(/\s+/).filter(word => word.length > 0);
    
    if (words.length === 0) return '';
    
    if (words.length === 1) {
      // Single word: take first 2-3 characters
      const word = words[0];
      if (word.length <= 3) return word.toUpperCase();
      return word.substring(0, 3).toUpperCase();
    } else if (words.length === 2) {
      // Two words: first letter of each word
      const first = words[0].charAt(0);
      const second = words[1].charAt(0);
      return (first + second).toUpperCase();
    } else {
      // Multiple words: first letter of first two words + first letter of last word
      const first = words[0].charAt(0);
      const second = words[1].charAt(0);
      const last = words[words.length - 1].charAt(0);
      return (first + second + last).toUpperCase();
    }
  };

  // Function to generate batch code from name
  const generateBatchCode = (name) => {
    if (!name || name.trim() === '') return '';
    
    // Remove special characters and split by spaces
    const cleanName = name.replace(/[^\w\s]/g, '').trim();
    const words = cleanName.split(/\s+/).filter(word => word.length > 0);
    
    if (words.length === 0) return '';
    
    if (words.length === 1) {
      // Single word: take first 2-3 characters
      const word = words[0];
      if (word.length <= 3) return word.toUpperCase();
      return word.substring(0, 3).toUpperCase();
    } else if (words.length === 2) {
      // Two words: first letter of each word
      const first = words[0].charAt(0);
      const second = words[1].charAt(0);
      return (first + second).toUpperCase();
    } else {
      // Multiple words: first letter of first two words + first letter of last word
      const first = words[0].charAt(0);
      const second = words[1].charAt(0);
      const last = words[words.length - 1].charAt(0);
      return (first + second + last).toUpperCase();
    }
  };

  const updateCustomDepartment = (index, field, value) => {
    const updated = [...customDepartments];
    updated[index] = { ...updated[index], [field]: value };
    
    // Auto-generate code when name is entered
    if (field === 'name' && value.trim() !== '') {
      const generatedCode = generateDepartmentCode(value);
      updated[index].code = generatedCode;
    }
    
    setCustomDepartments(updated);
  };

  const validateForm = () => {
    const errors = {};
    
    if (!formData.name.trim()) errors.name = 'Name is required';
    if (!formData.code.trim()) errors.code = 'Code is required';
    if (!formData.email.trim()) {
      errors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = 'Invalid email format';
    }
    
    // Validate contact persons
    if (contactPersons.length === 0) {
      errors.contactPersons = 'At least one contact person is required';
    } else {
      contactPersons.forEach((contact, index) => {
        if (!contact.name.trim()) {
          errors[`contact_person_${index}_name`] = 'Contact person name is required';
        }
        if (!contact.phone.trim()) {
          errors[`contact_person_${index}_phone`] = 'Contact person phone is required';
        }
        if (!contact.email.trim()) {
          errors[`contact_person_${index}_email`] = 'Contact person email is required';
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
          errors[`contact_person_${index}_email`] = 'Invalid contact person email format';
        }
      });
    }
    
    // Validate custom departments
    if (customDepartments.length > 0) {
      const usedCodes = new Set();
      const usedNames = new Set();
      
      // Add common department codes and names to the used sets
      departments.forEach(dept => {
        if (dept.code) usedCodes.add(dept.code.toUpperCase());
        if (dept.name) usedNames.add(dept.name.toLowerCase());
      });
      
      customDepartments.forEach((dept, index) => {
        if (!dept.name.trim()) {
          errors[`custom_dept_name_${index}`] = 'Department name is required';
        } else if (usedNames.has(dept.name.trim().toLowerCase())) {
          errors[`custom_dept_name_${index}`] = 'Department name must be unique';
        } else {
          usedNames.add(dept.name.trim().toLowerCase());
        }
        
        if (!dept.code.trim()) {
          errors[`custom_dept_code_${index}`] = 'Department code is required';
        } else if (usedCodes.has(dept.code.trim().toUpperCase())) {
          errors[`custom_dept_code_${index}`] = 'Department code must be unique';
        } else {
          usedCodes.add(dept.code.trim().toUpperCase());
        }
      });
      
      // Additional check: ensure no duplicate codes between existing and custom departments
      const existingCodes = departments.map(dept => dept.code.toUpperCase()).filter(Boolean);
      const customCodes = customDepartments
        .filter(dept => dept.name.trim() && dept.code.trim())
        .map(dept => dept.code.toUpperCase());
      
      const duplicateCodes = customCodes.filter(code => existingCodes.includes(code));
      if (duplicateCodes.length > 0) {
        errors.departments = `Department codes already exist: ${duplicateCodes.join(', ')}. Please use different codes.`;
      }
    }
    
    // Validate batches
    if (tempBatches.length > 0) {
      const usedBatchCodes = new Set();
      const usedBatchNames = new Set();
      
      tempBatches.forEach((batch, index) => {
        if (!batch.name.trim()) {
          errors[`batch_name_${index}`] = 'Batch name is required';
        } else if (usedBatchNames.has(batch.name.trim().toLowerCase())) {
          errors[`batch_name_${index}`] = 'Batch name must be unique';
        } else {
          usedBatchNames.add(batch.name.trim().toLowerCase());
        }
        
        if (!batch.code.trim()) {
          errors[`batch_code_${index}`] = 'Batch code is required';
        } else if (usedBatchCodes.has(batch.code.trim().toUpperCase())) {
          errors[`batch_code_${index}`] = 'Batch code must be unique';
        } else {
          usedBatchCodes.add(batch.code.trim().toUpperCase());
        }
        
        // Validate year ranges if provided
        if (batch.start_year && batch.end_year) {
          const startYear = parseInt(batch.start_year);
          const endYear = parseInt(batch.end_year);
          if (startYear >= endYear) {
            errors[`batch_years_${index}`] = 'Start year must be before end year';
          }
        }
      });
    }
    
    if (formData.established_year && (formData.established_year < 1800 || formData.established_year > new Date().getFullYear())) {
      errors.established_year = 'Invalid establishment year';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateCollege = async (e) => {
    e.preventDefault();
    
    // Validate form data
    const errors = {};
    
    if (!formData.name.trim()) errors.name = 'College name is required';
    if (!formData.code.trim()) errors.code = 'College code is required';
    if (!formData.email.trim()) errors.email = 'Email is required';
    
    // Validate that at least one contact person is provided
    const validContactPersons = contactPersons.filter(contact => 
      contact.name.trim() && contact.phone.trim() && contact.email.trim()
    );
    
    if (validContactPersons.length === 0) {
      errors.contactPersons = 'At least one contact person with name, phone, and email is required';
    }
    
    // Validate batches if provided
    if (tempBatches.length > 0) {
      const usedBatchCodes = new Set();
      const usedBatchNames = new Set();
      
      tempBatches.forEach((batch, index) => {
        if (!batch.name.trim()) {
          errors[`batch_name_${index}`] = 'Batch name is required';
        } else if (usedBatchNames.has(batch.name.trim().toLowerCase())) {
          errors[`batch_name_${index}`] = 'Batch name must be unique';
        } else {
          usedBatchNames.add(batch.name.trim().toLowerCase());
        }
        
        if (!batch.code.trim()) {
          errors[`batch_code_${index}`] = 'Batch code is required';
        } else if (usedBatchCodes.has(batch.code.trim().toUpperCase())) {
          errors[`batch_code_${index}`] = 'Batch code must be unique';
        } else {
          usedBatchCodes.add(batch.code.trim().toUpperCase());
        }
        
        // Validate year ranges if provided
        if (batch.start_year && batch.end_year) {
          const startYear = parseInt(batch.start_year);
          const endYear = parseInt(batch.end_year);
          if (startYear >= endYear) {
            errors[`batch_years_${index}`] = 'Start year must be before end year';
          }
        }
      });
    }
    
    // Validate established_year - must be a valid integer
    if (formData.established_year.trim()) {
      const year = parseInt(formData.established_year);
      if (isNaN(year) || year < 1800 || year > new Date().getFullYear()) {
        errors.established_year = `Year must be between 1800 and ${new Date().getFullYear()}`;
      }
    }
    
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    
    try {
      setLoading(true);
      
      // Prepare data for submission - convert established_year to integer or null
      const validContactPersons = contactPersons.filter(contact => 
        contact.name.trim() && contact.phone.trim() && contact.email.trim()
      );
      
      const validDepartments = [
        ...departments,
        ...customDepartments.filter(dept => dept.name.trim() && dept.code.trim())
      ];
      
      const validBatches = tempBatches.filter(batch => batch.name.trim() && batch.code.trim());
      
      const submitData = {
        ...formData,
        established_year: formData.established_year.trim() ? parseInt(formData.established_year) : null,
        contact_persons: validContactPersons,
        departments: validDepartments,
        batches: validBatches
      };
      
      // Final validation check
      if (validContactPersons.length === 0) {
        toast({
          title: "Error",
          description: "At least one contact person with name, phone, and email is required",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }
      
      const response = await apiService.createSuperAdminCollege(submitData);
      
      if (response.success) {
        toast({
          title: "Success!",
          description: "College created successfully.",
        });
        setIsCreateDialogOpen(false);
        resetForm();
        fetchColleges();
      } else {
        toast({
          title: "Error",
          description: response.message || "Failed to create college",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error creating college:', error);
      toast({
        title: "Error",
        description: "Failed to create college. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateCollege = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    try {
      setLoading(true);
      
      // Check for duplicate department codes between existing and custom departments
      const existingCodes = new Set(departments.map(dept => dept.code.toUpperCase()));
      const customDeptCodes = customDepartments
        .filter(dept => dept.name.trim() && dept.code.trim())
        .map(dept => dept.code.toUpperCase());
      
      const duplicateCodes = customDeptCodes.filter(code => existingCodes.has(code));
      if (duplicateCodes.length > 0) {
        toast({
          variant: "destructive",
          title: "Duplicate Department Codes",
          description: `Department codes already exist: ${duplicateCodes.join(', ')}. Please use different codes.`
        });
        return;
      }
      
      // Prepare data for submission - convert established_year to integer or null
      const submitData = {
        ...formData,
        established_year: formData.established_year.trim() ? parseInt(formData.established_year) : null,
        contact_persons: contactPersons.filter(contact =>
          contact.name.trim() && contact.phone.trim() && contact.email.trim()
        ),
        departments: [
          ...departments,
          ...customDepartments.filter(dept => dept.name.trim() && dept.code.trim())
        ]
      };
      
      const response = await apiService.updateSuperAdminCollege(selectedCollege.id, submitData);
      if (response.success) {
        toast({
          title: "Success",
          description: "College updated successfully"
        });
        setIsEditDialogOpen(false);
        resetForm();
        fetchColleges();
      } else {
        toast({
          title: "Error",
          description: response.message || "Failed to update college",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error updating college:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update college"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCollege = async (collegeId) => {
    try {
      // First, try to delete the college normally
      const response = await apiService.deleteSuperAdminCollege(collegeId);
      if (response.success) {
        toast({
          title: "Success",
          description: "College deleted successfully"
        });
        fetchColleges();
        return;
      }
    } catch (error) {
      // If the error is about active users, handle it specially
      if (error.message && error.message.includes("Cannot delete college with active users")) {
        // Show a more informative confirmation dialog
        const action = window.confirm(
          "⚠️  CANNOT DELETE COLLEGE ⚠️\n\n" +
          "This college has active students and/or faculty members.\n\n" +
          "To delete this college, you must first:\n" +
          "1. Deactivate or delete all students\n" +
          "2. Deactivate or delete all faculty\n" +
          "3. Remove all contact persons\n" +
          "4. Remove all departments\n" +
          "5. Then try deleting the college again\n\n" +
          "Would you like to:\n" +
          "• View the college details to see all data? (Click Cancel)\n" +
          "• Try to delete anyway? (Click OK)\n\n" +
          "Click OK to attempt deletion, or Cancel to view details first."
        );
        
        if (action) {
          // User wants to try deletion anyway
          await handleCascadingDelete(collegeId);
        } else {
          // User wants to view details first - find the college and open view dialog
          const college = colleges.find(c => c.id === collegeId);
          if (college) {
            openViewDialog(college);
          }
        }
      } else {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to delete college"
      });
      }
    }
  };

  const handleCascadingDelete = async (collegeId) => {
    try {
      setLoading(true);
      
      // First, get the college details to see what needs to be deleted
      const collegeResponse = await apiService.getSuperAdminCollegeDetails(collegeId);
      if (!collegeResponse.success) {
        throw new Error("Failed to fetch college details");
      }
      
      const college = collegeResponse.data;
      
      // Show progress toast
      toast({
        title: "Deleting College",
        description: `Deleting ${college.name} and all associated data...`,
        variant: "default"
      });

      // Since the backend doesn't support force delete yet, we'll use a different approach
      // We'll try to delete the college normally first, and if it fails, show a message
      // about needing to handle this on the backend
      try {
        const deleteResponse = await apiService.deleteSuperAdminCollege(collegeId);
        if (deleteResponse.success) {
          toast({
            title: "Success",
            description: `${college.name} has been deleted successfully`
          });
          fetchColleges();
          return;
        }
      } catch (deleteError) {
        // If deletion fails, show a message about the backend limitation
        toast({
          variant: "destructive",
          title: "Backend Limitation",
          description: "The backend currently prevents deletion of colleges with active users. " +
                      "To enable complete deletion, the backend needs to be updated to support cascading deletes. " +
                      "For now, please deactivate all users manually before deleting the college.",
          duration: 8000
        });
        
        // Log the error for debugging
        console.error('College deletion failed:', deleteError);
        // console.log('College details:', college);
        // console.log('Student count:', college.student_count);
        // console.log('Faculty count:', college.faculty_count);
      }
    } catch (error) {
      console.error('Error in cascading delete:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to process college deletion. Please try again."
      });
    } finally {
      setLoading(false);
    }
  };

  // Helper function to deactivate all users in a college
  const deactivateAllUsersInCollege = async (collegeId) => {
    try {
      setLoading(true);
      
      // Get all users in the college
      const [studentsRes, facultyRes] = await Promise.all([
        apiService.getSuperAdminUsers({ college_id: collegeId, role: 'student', limit: 1000 }),
        apiService.getSuperAdminUsers({ college_id: collegeId, role: 'faculty', limit: 1000 })
      ]);
      
      // Handle both response structures: data.users (old) and data (new)
      const students = Array.isArray(studentsRes.data) ? studentsRes.data : (studentsRes.data.users || []);
      const faculty = Array.isArray(facultyRes.data) ? facultyRes.data : (facultyRes.data.users || []);
      
      if (students.length === 0 && faculty.length === 0) {
        toast({
          title: "No Users Found",
          description: "This college has no active users to deactivate.",
          variant: "default"
        });
        return;
      }
      
      // Show confirmation for bulk deactivation
      const confirmDeactivation = window.confirm(
        `⚠️  BULK DEACTIVATION ⚠️\n\n` +
        `This will deactivate ALL users in the college:\n` +
        `• Students: ${students.length}\n` +
        `• Faculty: ${faculty.length}\n\n` +
        `After deactivation, you can delete the college.\n\n` +
        `Are you sure you want to proceed?`
      );
      
      if (!confirmDeactivation) return;
      
      // Deactivate all students
      const studentDeactivations = students.map(student => 
        apiService.toggleSuperAdminUserStatus(student.id)
      );
      
      // Deactivate all faculty
      const facultyDeactivations = faculty.map(facultyMember => 
        apiService.toggleSuperAdminUserStatus(facultyMember.id)
      );
      
      // Execute all deactivations
      await Promise.all([...studentDeactivations, ...facultyDeactivations]);
      
      toast({
        title: "Users Deactivated",
        description: `Successfully deactivated ${students.length} students and ${faculty.length} faculty members. You can now delete the college.`,
        variant: "default"
      });
      
      // Refresh the colleges list to show updated counts
      fetchColleges();
      
    } catch (error) {
      console.error('Error deactivating users:', error);
      toast({
        variant: "destructive",
        title: "Deactivation Failed",
        description: "Failed to deactivate users. Please try again or contact support."
      });
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    const emptyFormData = {
      name: '',
      code: '',
      email: '',
      phone: '',
      address: '',
      city: '',
      state: '',
      country: 'India',
      postal_code: '',
      website: '',
      logo_url: '',
      established_year: '',
      accreditation: '',
      description: ''
    };
    setFormData(emptyFormData);
    setContactPersons([{ name: '', phone: '', email: '', designation: '' }]);
    setDepartments([]);
    setCustomDepartments([{ name: '', code: '', description: '' }]);
    setTempBatches([]);
    setFormErrors({});
    setSelectedCollege(null);
  };

  const openCreateDialog = () => {
    resetForm();
    // Add a default batch for convenience
    setTempBatches([{ name: '', code: '', description: '' }]);
    setIsCreateDialogOpen(true);
  };

  const openEditDialog = async (college) => {
    setSelectedCollege(college);
    
    try {
      // Fetch detailed college data including contact persons and departments
      const response = await apiService.getSuperAdminCollegeDetails(college.id);
      
      if (response.success) {
        const collegeData = response.data;
        
        // Set basic form data
        setFormData({
          name: collegeData.name || '',
          code: collegeData.code || '',
          email: collegeData.email || '',
          phone: collegeData.phone || '',
          address: collegeData.address || '',
          city: collegeData.city || '',
          state: collegeData.state || '',
          country: collegeData.country || 'India',
          postal_code: collegeData.postal_code || '',
          website: collegeData.website || '',
          logo_url: collegeData.logo_url || '',
          established_year: collegeData.established_year || '',
          accreditation: collegeData.accreditation || '',
          description: collegeData.description || ''
        });
        
        // Set contact persons
        if (collegeData.contact_persons && Array.isArray(collegeData.contact_persons)) {
          setContactPersons(collegeData.contact_persons.map(cp => ({
            name: cp.name || '',
            phone: cp.phone || '',
            email: cp.email || '',
            designation: cp.designation || ''
          })));
        } else {
          setContactPersons([{ name: '', phone: '', email: '', designation: '' }]);
        }
        
        // Set departments (these are the common/default departments)
        if (collegeData.departments && Array.isArray(collegeData.departments)) {
          setDepartments(collegeData.departments.map(dept => ({
            id: dept.id || Date.now(),
            name: dept.name || '',
            code: dept.code || '',
            description: dept.description || ''
          })));
        } else {
          setDepartments([]);
        }
        
        // For editing, we'll start with one empty custom department slot
        // Users can add more if needed
        setCustomDepartments([{ name: '', code: '', description: '' }]);
      }
    } catch (error) {
      console.error('Error fetching college details:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load college details"
      });
      
      // Fallback to basic data
    setFormData({
      name: college.name || '',
      code: college.code || '',
      email: college.email || '',
      phone: college.phone || '',
      address: college.address || '',
      city: college.city || '',
      state: college.state || '',
      country: college.country || 'India',
      postal_code: college.postal_code || '',
      website: college.website || '',
      logo_url: college.logo_url || '',
      established_year: college.established_year || '',
      accreditation: college.accreditation || '',
      description: college.description || ''
    });
      
      setContactPersons([{ name: '', phone: '', email: '', designation: '' }]);
      setDepartments([]);
      setCustomDepartments([{ name: '', code: '', description: '' }]);
    }
    
    setFormErrors({});
    setIsEditDialogOpen(true);
  };

  const openViewDialog = async (college) => {
    setSelectedCollege(college);
    
    try {
      // Fetch detailed college data including contact persons and departments
      const response = await apiService.getSuperAdminCollegeDetails(college.id);
      
      if (response.success) {
        setSelectedCollege(response.data);
      }
    } catch (error) {
      console.error('Error fetching college details:', error);
      // Keep the original college data if fetch fails
    }
    
    setIsViewDialogOpen(true);
    setStudentSearch('');
    setFacultySearch('');
    setStudentPage(1);
    setFacultyPage(1);
    fetchCollegeUsers(college.id, 1, '', 1, '', false); // Use normal pagination
  };

  const openContactPersonDialog = async (college) => {
    setSelectedCollege(college);
    
    try {
      // Fetch detailed college data including contact persons
      const response = await apiService.getSuperAdminCollegeDetails(college.id);
      
      if (response.success) {
        setSelectedCollege(response.data);
      }
    } catch (error) {
      console.error('Error fetching college details:', error);
      // Keep the original college data if fetch fails
    }
    
    setIsContactPersonDialogOpen(true);
  };

  const openStudentsDialog = async (college) => {
    setSelectedCollege(college);
    
    try {
      // Fetch detailed college data including departments
      const response = await apiService.getSuperAdminCollegeDetails(college.id);
      
      if (response.success) {
        setSelectedCollege(response.data);
      }
    } catch (error) {
      console.error('Error fetching college details:', error);
      // Keep the original college data if fetch fails
    }
    
    setIsStudentsDialogOpen(true);
    setStudentSearch('');
    setStudentPage(1);
    fetchCollegeUsers(college.id, 1, '', 1, '', false); // Use normal pagination
  };

  const openFacultyDialog = async (college) => {
    setSelectedCollege(college);
    
    try {
      // Fetch detailed college data including departments
      const response = await apiService.getSuperAdminCollegeDetails(college.id);
      
      if (response.success) {
        setSelectedCollege(response.data);
      }
    } catch (error) {
      console.error('Error fetching college details:', error);
      // Keep the original college data if fetch fails
    }
    
    setIsFacultyDialogOpen(true);
    setStudentSearch('');
    setFacultySearch('');
    setStudentPage(1);
    setFacultyPage(1);
    fetchCollegeUsers(college.id, 1, '', 1, '', true); // fetchAll = true to get all users
  };

  const openDepartmentsDialog = async (college) => {
    setSelectedCollege(college);
    
    try {
      // Fetch detailed college data including departments
      const response = await apiService.getSuperAdminCollegeDetails(college.id);
      
      if (response.success) {
        setSelectedCollege(response.data);
        // Initialize temporary departments for editing
        setTempDepartments(response.data.departments || []);
        setTempCustomDepartments(response.data.custom_departments || []);
      }
    } catch (error) {
      console.error('Error fetching college details:', error);
      // Keep the original college data if fetch fails
    }
    
    setIsDepartmentsDialogOpen(true);
    setShowAddDepartmentForm(false);
    setEditingDepartmentIndex(null);
    setNewDepartment({ name: '', code: '', description: '' });
  };

  const openBatchesDialog = async (college) => {
    setSelectedCollege(college);
    
    try {
      // Fetch batches for this college
      const response = await apiService.getBatches({ college_id: college.id });
      
      if (response.success) {
        setTempBatches(response.data || []);
      }
    } catch (error) {
      console.error('Error fetching batches:', error);
      setTempBatches([]);
    }
    
    setIsBatchesDialogOpen(true);
    setShowAddBatchForm(false);
    setEditingBatchIndex(null);
    setNewBatch({ name: '', code: '', description: '', start_year: '', end_year: '' });
  };

  // Reset department form when dialog closes
  const handleCloseDepartmentsDialog = () => {
    setIsDepartmentsDialogOpen(false);
    setShowAddDepartmentForm(false);
    setEditingDepartmentIndex(null);
    setNewDepartment({ name: '', code: '', description: '' });
    setTempDepartments([]);
    setTempCustomDepartments([]);
  };

  // Reset batch form when dialog closes
  const handleCloseBatchesDialog = () => {
    setIsBatchesDialogOpen(false);
    setShowAddBatchForm(false);
    setEditingBatchIndex(null);
    setNewBatch({ name: '', code: '', description: '', start_year: '', end_year: '' });
    setTempBatches([]);
  };

  // Handle adding a new department
  const handleAddDepartment = () => {
    if (!newDepartment.name.trim() || !newDepartment.code.trim()) {
      toast({
        title: "Validation Error",
        description: "Department name and code are required",
        variant: "destructive"
      });
      return;
    }

    // Check if department name or code already exists
    const existingDept = selectedCollege.departments?.find(
      dept => dept.name.toLowerCase() === newDepartment.name.toLowerCase() ||
              dept.code.toLowerCase() === newDepartment.code.toLowerCase()
    );

    if (existingDept) {
      toast({
        title: "Duplicate Department",
        description: "A department with this name or code already exists",
        variant: "destructive"
      });
      return;
    }

    // Add the new department to the local state
    const updatedCollege = {
      ...selectedCollege,
      departments: [...(selectedCollege.departments || []), newDepartment]
    };
    setSelectedCollege(updatedCollege);

    // Reset form
    setNewDepartment({ name: '', code: '', description: '' });
    setShowAddDepartmentForm(false);

    toast({
      title: "Department Added",
      description: `${newDepartment.name} department has been added to the list. Click "Save Changes" to save to the database.`,
      variant: "default"
    });
  };

  // Handle removing a department
  const handleRemoveDepartment = async (index) => {
    const departmentToRemove = selectedCollege.departments[index];
    
    if (window.confirm(`Are you sure you want to remove the "${departmentToRemove.name}" department? This action cannot be undone.`)) {
      try {
        const updatedDepartments = selectedCollege.departments.filter((_, i) => i !== index);
        const updatedCollege = {
          ...selectedCollege,
          departments: updatedDepartments
        };
        setSelectedCollege(updatedCollege);

        // Update the college in the backend
        await apiService.updateSuperAdminCollege(selectedCollege.id, {
          ...selectedCollege,
          departments: updatedDepartments
        });

        // Refresh the colleges list to show updated counts
        fetchColleges();

        toast({
          title: "Department Removed",
          description: `${departmentToRemove.name} department has been removed`,
          variant: "default"
        });
      } catch (error) {
        console.error('Error removing department:', error);
        toast({
          title: "Error",
          description: "Failed to remove department. Please try again.",
          variant: "destructive"
        });
      }
    }
  };

  // Handle editing a department
  const handleEditDepartment = (index) => {
    const dept = selectedCollege.departments[index];
    setEditingDepartmentIndex(index);
    setNewDepartment({ ...dept });
    setShowAddDepartmentForm(true);
  };

  // Handle updating an edited department
  const handleUpdateDepartment = () => {
    if (!newDepartment.name.trim() || !newDepartment.code.trim()) {
      toast({
        title: "Validation Error",
        description: "Department name and code are required",
        variant: "destructive"
      });
      return;
    }

    // Check if department name or code already exists (excluding the current one being edited)
    const existingDept = selectedCollege.departments?.find(
      (dept, i) => i !== editingDepartmentIndex && 
      (dept.name.toLowerCase() === newDepartment.name.toLowerCase() ||
       dept.code.toLowerCase() === newDepartment.code.toLowerCase())
    );

    if (existingDept) {
      toast({
        title: "Duplicate Department",
        description: "A department with this name or code already exists",
        variant: "destructive"
      });
      return;
    }

    // Update the department in local state
    const updatedDepartments = [...selectedCollege.departments];
    updatedDepartments[editingDepartmentIndex] = newDepartment;
    
    const updatedCollege = {
      ...selectedCollege,
      departments: updatedDepartments
    };
    setSelectedCollege(updatedCollege);

    // Reset form and editing state
    setNewDepartment({ name: '', code: '', description: '' });
    setShowAddDepartmentForm(false);
    setEditingDepartmentIndex(null);

    toast({
      title: "Department Updated",
      description: `${newDepartment.name} department has been updated in the list. Click "Save Changes" to save to the database.`,
      variant: "default"
    });
  };



  // Handle removing a common department
  const handleRemoveCommonDepartment = (index) => {
    const departmentToRemove = selectedCollege.departments[index];
    
    if (window.confirm(`Are you sure you want to remove "${departmentToRemove.name}"?`)) {
      const updatedDepartments = selectedCollege.departments.filter((_, i) => i !== index);
      setSelectedCollege({
        ...selectedCollege,
        departments: updatedDepartments
      });

      toast({
        title: "Department Removed",
        description: `${departmentToRemove.name} has been removed from the list. Click "Save Changes" to save to the database.`,
        variant: "default"
      });
    }
  };

  // Save all department changes
  const handleSaveAllDepartments = async () => {
    try {
      await apiService.updateSuperAdminCollege(selectedCollege.id, {
        ...selectedCollege,
        departments: selectedCollege.departments
      });

      // Refresh the colleges list
      fetchColleges();

      toast({
        title: "Changes Saved",
        description: "All department changes have been saved successfully",
        variant: "default"
      });

      // Close the dialog
      handleCloseDepartmentsDialog();
    } catch (error) {
      console.error('Error saving departments:', error);
      toast({
        title: "Error",
        description: "Failed to save department changes. Please try again.",
        variant: "destructive"
      });
    }
  };

  // Batch management functions
  const handleAddBatch = async () => {
    if (!newBatch.name.trim() || !newBatch.code.trim()) {
      toast({
        title: "Validation Error",
        description: "Batch name and code are required",
        variant: "destructive"
      });
      return;
    }

    try {
      const response = await apiService.createBatch({
        college_id: selectedCollege.id,
        name: newBatch.name.trim(),
        code: newBatch.code.trim(),
        description: newBatch.description.trim(),
        start_year: newBatch.start_year ? parseInt(newBatch.start_year) : null,
        end_year: newBatch.end_year ? parseInt(newBatch.end_year) : null
      });

      if (response.success) {
        // Add the new batch to the local state
        setTempBatches([...tempBatches, response.data]);
        
        // Reset form
        setNewBatch({ name: '', code: '', description: '', start_year: '', end_year: '' });
        setShowAddBatchForm(false);

        toast({
          title: "Batch Created",
          description: `${newBatch.name} batch has been created successfully`,
          variant: "default"
        });

        // Refresh colleges to update batch count
        fetchColleges();
      }
    } catch (error) {
      console.error('Error creating batch:', error);
      toast({
        title: "Error",
        description: error.response?.data?.message || "Failed to create batch. Please try again.",
        variant: "destructive"
      });
    }
  };

  const handleEditBatch = (index) => {
    const batch = tempBatches[index];
    setNewBatch({
      name: batch.name,
      code: batch.code,
      description: batch.description || '',
      start_year: batch.start_year ? batch.start_year.toString() : '',
      end_year: batch.end_year ? batch.end_year.toString() : ''
    });
    setEditingBatchIndex(index);
    setShowAddBatchForm(true);
  };

  const handleUpdateBatch = async () => {
    if (!newBatch.name.trim() || !newBatch.code.trim()) {
      toast({
        title: "Validation Error",
        description: "Batch name and code are required",
        variant: "destructive"
      });
      return;
    }

    try {
      const batchToUpdate = tempBatches[editingBatchIndex];
      const response = await apiService.updateBatch(batchToUpdate.id, {
        name: newBatch.name.trim(),
        code: newBatch.code.trim(),
        description: newBatch.description.trim(),
        start_year: newBatch.start_year ? parseInt(newBatch.start_year) : null,
        end_year: newBatch.end_year ? parseInt(newBatch.end_year) : null
      });

      if (response.success) {
        // Update the batch in the local state
        const updatedBatches = [...tempBatches];
        updatedBatches[editingBatchIndex] = {
          ...batchToUpdate,
          name: newBatch.name.trim(),
          code: newBatch.code.trim(),
          description: newBatch.description.trim(),
          start_year: newBatch.start_year ? parseInt(newBatch.start_year) : null,
          end_year: newBatch.end_year ? parseInt(newBatch.end_year) : null
        };
        setTempBatches(updatedBatches);

        // Reset form
        setNewBatch({ name: '', code: '', description: '', start_year: '', end_year: '' });
        setShowAddBatchForm(false);
        setEditingBatchIndex(null);

        toast({
          title: "Batch Updated",
          description: "Batch has been updated successfully",
          variant: "default"
        });
      }
    } catch (error) {
      console.error('Error updating batch:', error);
      toast({
        title: "Error",
        description: error.response?.data?.message || "Failed to update batch. Please try again.",
        variant: "destructive"
      });
    }
  };

  const handleDeleteBatch = async (batchId) => {
    if (window.confirm('Are you sure you want to delete this batch? This action cannot be undone.')) {
      try {
        const response = await apiService.deleteBatch(batchId);
        
        if (response.success) {
          // Remove the batch from the local state
          setTempBatches(tempBatches.filter(batch => batch.id !== batchId));
          
          toast({
            title: "Batch Deleted",
            description: "Batch has been deleted successfully",
            variant: "default"
          });

          // Refresh colleges to update batch count
          fetchColleges();
        }
      } catch (error) {
        console.error('Error deleting batch:', error);
        toast({
          title: "Error",
          description: error.response?.data?.message || "Failed to delete batch. Please try again.",
          variant: "destructive"
        });
      }
    }
  };

  // Handle viewing students in a department
  const handleViewDepartmentStudents = async (department, page = 1) => {
    try {
      setLoading(true);
      
      // Fetch students in this department
      const response = await apiService.getUsers({
        role: 'student',
        college_id: selectedCollege.id,
        department: department.name,
        page: page,
        limit: viewStudentsPagination.limit
      });
      
      if (response.success) {
        setViewStudentsData({
          type: 'department',
          name: department.name,
          students: response.data || []
        });
        setViewStudentsPagination({
          page: page,
          limit: viewStudentsPagination.limit,
          total: response.pagination?.total || 0,
          totalPages: response.pagination?.totalPages || 0
        });
        setIsViewStudentsDialogOpen(true);
      } else {
        throw new Error(response.message || 'Failed to fetch students');
      }
    } catch (error) {
      console.error('Error fetching department students:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to fetch students for this department."
      });
    } finally {
      setLoading(false);
    }
  };

  // Handle viewing students in a batch
  const handleViewBatchStudents = async (batch, page = 1) => {
    try {
      setLoading(true);
      
      // Fetch students in this batch
      const response = await apiService.getUsers({
        role: 'student',
        college_id: selectedCollege.id,
        batch: batch.name,
        page: page,
        limit: viewStudentsPagination.limit
      });
      
      if (response.success) {
        setViewStudentsData({
          type: 'batch',
          name: batch.name,
          students: response.data || []
        });
        setViewStudentsPagination({
          page: page,
          limit: viewStudentsPagination.limit,
          total: response.pagination?.total || 0,
          totalPages: response.pagination?.totalPages || 0
        });
        setIsViewStudentsDialogOpen(true);
      } else {
        throw new Error(response.message || 'Failed to fetch students');
      }
    } catch (error) {
      console.error('Error fetching batch students:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to fetch students for this batch."
      });
    } finally {
      setLoading(false);
    }
  };

  // Fetch student counts for all departments
  const fetchDepartmentStudentCounts = async () => {
    if (!selectedCollege || !selectedCollege.departments) return;
    
    try {
      const counts = {};
      for (const dept of selectedCollege.departments) {
        const response = await apiService.getUsers({
          role: 'student',
          college_id: selectedCollege.id,
          department: dept.name,
          page: 1,
          limit: 1 // We only need the count
        });
        
        if (response.success) {
          counts[dept.name] = response.pagination?.total || 0;
        } else {
          counts[dept.name] = 0;
        }
      }
      setDepartmentStudentCounts(counts);
    } catch (error) {
      console.error('Error fetching department student counts:', error);
    }
  };

  // Fetch student counts for all batches
  const fetchBatchStudentCounts = async () => {
    if (!tempBatches || tempBatches.length === 0) return;
    
    try {
      const counts = {};
      for (const batch of tempBatches) {
        const response = await apiService.getUsers({
          role: 'student',
          college_id: selectedCollege.id,
          batch: batch.name,
          page: 1,
          limit: 1 // We only need the count
        });
        
        if (response.success) {
          counts[batch.name] = response.pagination?.total || 0;
        } else {
          counts[batch.name] = 0;
        }
      }
      setBatchStudentCounts(counts);
    } catch (error) {
      console.error('Error fetching batch student counts:', error);
    }
  };

  // Handle pagination for View Students dialog
  const handleViewStudentsPageChange = async (newPage) => {
    if (viewStudentsData.type === 'department') {
      // Create a department object with the name from viewStudentsData
      const department = { name: viewStudentsData.name };
      await handleViewDepartmentStudents(department, newPage);
    } else if (viewStudentsData.type === 'batch') {
      // Create a batch object with the name from viewStudentsData
      const batch = { name: viewStudentsData.name };
      await handleViewBatchStudents(batch, newPage);
    }
  };

  // Contact sharing functions
  const copyContactToClipboard = async (contact) => {
    const contactText = `Name: ${contact.name}\nPhone: ${contact.phone}\nEmail: ${contact.email}${contact.designation ? `\nDesignation: ${contact.designation}` : ''}`;
    
    try {
      await navigator.clipboard.writeText(contactText);
      toast({
        title: "Copied!",
        description: "Contact information copied to clipboard",
        variant: "default"
      });
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      toast({
        title: "Error",
        description: "Failed to copy to clipboard",
        variant: "destructive"
      });
    }
  };

  // Generate QR code for contact sharing
  const generateContactQRCode = async (contact) => {
    try {
      const contactData = {
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        designation: contact.designation || '',
        type: 'contact'
      };
      
      const qrData = JSON.stringify(contactData);
      const dataUrl = await QRCode.toDataURL(qrData, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });
      
      setQrCodeDataUrl(dataUrl);
      setActiveContact(contact);
      setShowQRCode(true);
    } catch (error) {
      console.error('Failed to generate QR code:', error);
      toast({
        title: "Error",
        description: "Failed to generate QR code",
        variant: "destructive"
      });
    }
  };

  // Download QR code
  const downloadQRCode = async () => {
    if (!qrCodeDataUrl) return;
    
    try {
      const link = document.createElement('a');
      link.download = `contact-${activeContact?.name || 'qr'}.png`;
      link.href = qrCodeDataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      toast({
        title: "Downloaded!",
        description: "QR code downloaded successfully",
        variant: "default"
      });
    } catch (error) {
      console.error('Failed to download QR code:', error);
      toast({
        title: "Error",
        description: "Failed to download QR code",
        variant: "destructive"
      });
    }
  };

  // Enhanced email sharing with inline input
  const handleEmailShare = (contact) => {
    setActiveContact(contact);
    setShowEmailInput(true);
    setShowWhatsappInput(false);
    setEmailRecipient('');
  };

  // Enhanced WhatsApp sharing with inline input
  const handleWhatsAppShare = (contact) => {
    setActiveContact(contact);
    setShowWhatsappInput(true);
    setShowEmailInput(false);
    setWhatsappRecipient('');
  };

  // Send email with recipient input
  const sendEmail = async () => {
    if (!emailRecipient.trim()) {
      toast({
        title: "Error",
        description: "Please enter recipient email address",
        variant: "destructive"
      });
      return;
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailRecipient)) {
      toast({
        title: "Invalid Email",
        description: "Please enter a valid email address",
        variant: "destructive"
      });
      return;
    }
    
    if (!activeContact) {
      toast({
        title: "Error",
        description: "Contact information is missing",
        variant: "destructive"
      });
      return;
    }
    
    try {
      // Show loading state
      toast({
        title: "Sending...",
        description: "Sending email via SMTP service",
      });
      
      // Call API to send email via SMTP
      const response = await apiService.post('/email/send-contact', {
        recipientEmail: emailRecipient.trim(),
        contactInfo: {
          name: activeContact.name,
          phone: activeContact.phone || null,
          email: activeContact.email || null,
          designation: activeContact.designation || null
        }
      });
      
      if (response.success) {
        toast({
          title: "Email Sent!",
          description: `Contact information sent to ${emailRecipient}`,
          variant: "default"
        });
        
            // Reset and hide input
        setEmailRecipient('');
        setShowEmailInput(false);
        setActiveContact(null);
      } else {
        throw new Error(response.message || 'Failed to send email');
      }
    } catch (error) {
      console.error('Error sending email:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to send email. Please check your SMTP configuration.",
        variant: "destructive"
      });
    }
  };

  // Send WhatsApp with recipient input
  const sendWhatsApp = () => {
    if (!whatsappRecipient.trim()) {
      toast({
        title: "Error",
        description: "Please enter recipient phone number",
        variant: "destructive"
      });
      return;
    }
    
    // Remove any non-digit characters except +
    const cleanPhone = whatsappRecipient.replace(/[^\d+]/g, '');
    
    if (!cleanPhone || cleanPhone.length < 10) {
      toast({
        title: "Invalid Phone Number",
        description: "Please enter a valid phone number with country code",
        variant: "destructive"
      });
      return;
    }
    
    const message = `Contact Information - ${activeContact.name}:\n\nName: ${activeContact.name}\nPhone: ${activeContact.phone}\nEmail: ${activeContact.email}${activeContact.designation ? `\nDesignation: ${activeContact.designation}` : ''}`;
    
    // Open WhatsApp with recipient pre-filled
    const whatsappLink = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
    window.open(whatsappLink, '_blank');
    
    // Reset and hide input
    setWhatsappRecipient('');
    setShowWhatsappInput(false);
    
    toast({
      title: "WhatsApp Opened",
      description: `WhatsApp opened for ${cleanPhone}`,
      variant: "default"
    });
  };

  // Close sharing inputs
  const closeSharingInputs = () => {
    setShowEmailInput(false);
    setShowWhatsappInput(false);
    setEmailRecipient('');
    setWhatsappRecipient('');
    setActiveContact(null);
  };

  // Close QR code modal
  const closeQRCode = () => {
    setShowQRCode(false);
    setQrCodeDataUrl('');
    setActiveContact(null);
  };

  // Legacy contact sharing functions
  const copyLegacyContactToClipboard = async (college) => {
    const contactText = `Name: ${college.contact_person}\nPhone: ${college.contact_person_phone || 'N/A'}\nEmail: ${college.contact_person_email || 'N/A'}${college.contact_person_designation ? `\nDesignation: ${college.contact_person_designation}` : ''}`;
    
    try {
      await navigator.clipboard.writeText(contactText);
      toast({
        title: "Copied!",
        description: "Contact information copied to clipboard",
        variant: "default"
      });
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      toast({
        title: "Error",
        description: "Failed to copy to clipboard",
        variant: "destructive"
      });
    }
  };

  // Legacy email sharing
  const shareLegacyContactViaEmail = (college) => {
    const contact = {
      name: college.contact_person,
      phone: college.contact_person_phone || '',
      email: college.contact_person_email || '',
      designation: college.contact_person_designation || ''
    };
    handleEmailShare(contact);
  };

  // Legacy WhatsApp sharing
  const shareLegacyContactViaWhatsApp = (college) => {
    const contact = {
      name: college.contact_person,
      phone: college.contact_person_phone || '',
      email: college.contact_person_email || '',
      designation: college.contact_person_designation || ''
    };
    handleWhatsAppShare(contact);
  };

  // Legacy QR code generation
  const generateLegacyQRCode = async (college) => {
    const contact = {
      name: college.contact_person,
      phone: college.contact_person_phone || '',
      email: college.contact_person_email || '',
      designation: college.contact_person_designation || ''
    };
    await generateContactQRCode(contact);
  };





  const getStatusBadge = (isActive) => {
    return isActive ? (
      <Badge className="bg-green-100 text-green-800">Active</Badge>
    ) : (
      <Badge variant="secondary">Inactive</Badge>
    );
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const handlePageChange = (newPage) => {
    setPagination(prev => ({ ...prev, page: newPage }));
  };

  const handleLimitChange = (newLimit) => {
    setPagination(prev => ({ ...prev, limit: newLimit, page: 1 }));
  };

  // Fetch students and faculty for selected college with search and pagination
  const fetchCollegeUsers = async (collegeId, sPage = 1, sSearch = '', fPage = 1, fSearch = '', fetchAll = false) => {
    try {
      const [stuRes, facRes] = await Promise.all([
        apiService.getSuperAdminUsers({ 
          college_id: collegeId, 
          role: 'student', 
          limit: fetchAll ? 1000 : studentsPerPage, // Use large limit if fetching all
          page: sPage, 
          search: sSearch 
        }),
        apiService.getSuperAdminUsers({ 
          college_id: collegeId, 
          role: 'faculty', 
          limit: fetchAll ? 1000 : facultyPerPage, // Use large limit if fetching all
          page: fPage, 
          search: fSearch 
        })
      ]);
      
      // Handle both response structures: data.users (old) and data (new)
      const studentUsers = Array.isArray(stuRes.data) ? stuRes.data : (stuRes.data.users || []);
      const facultyUsers = Array.isArray(facRes.data) ? facRes.data : (facRes.data.users || []);
      
      setStudents(studentUsers);
      
      // Enhanced total count calculation with multiple fallbacks
      const studentTotal = stuRes.data.pagination?.total || 
                          stuRes.data.total || 
                          stuRes.data.count ||
                          stuRes.total ||
                          (selectedCollege?.student_count && studentUsers.length === studentsPerPage ? selectedCollege.student_count : 
                           // Try to find the college in the main colleges list
                           colleges.find(c => c.id === collegeId)?.student_count || studentUsers.length);
      

      
      setStudentTotal(studentTotal);
      
      const facultyTotal = facRes.data.pagination?.total || 
                          facRes.data.total || 
                          facRes.data.count ||
                          facRes.total ||
                          facultyUsers.length;
      setFaculty(facultyUsers);
      setFacultyTotal(facultyTotal);
      
      // Update the selected college with fresh user counts
      if (selectedCollege) {
        setSelectedCollege(prev => ({
          ...prev,
          student_count: studentTotal,
          faculty_count: facultyTotal
        }));
      }
    } catch (e) {
      console.error('Error in fetchCollegeUsers:', e);
      setStudents([]);
      setFaculty([]);
      setStudentTotal(0);
      setFacultyTotal(0);
    }
  };

  // Handlers for search and pagination
  const handleStudentSearch = (e) => {
    setStudentSearch(e.target.value);
    setStudentPage(1);
    if (selectedCollege) fetchCollegeUsers(selectedCollege.id, 1, e.target.value, facultyPage, facultySearch, false);
  };
  const handleFacultySearch = (e) => {
    setFacultySearch(e.target.value);
    setFacultyPage(1);
    if (selectedCollege) fetchCollegeUsers(selectedCollege.id, studentPage, studentSearch, 1, e.target.value, false);
  };
  const handleStudentPage = (newPage) => {
    setStudentPage(newPage);
    if (selectedCollege) fetchCollegeUsers(selectedCollege.id, newPage, studentSearch, facultyPage, facultySearch, false);
  };
  const handleFacultyPage = (newPage) => {
    setFacultyPage(newPage);
    if (selectedCollege) fetchCollegeUsers(selectedCollege.id, studentPage, studentSearch, newPage, facultySearch, false);
  };

  // Function to handle year input changes
  const handleYearChange = (value, fieldName = 'established_year') => {
    const trimmedValue = value.trim();
    
    if (trimmedValue === '') {
      // Allow empty value
      setFormData({ ...formData, [fieldName]: '' });
      return;
    }
    
    const year = parseInt(trimmedValue);
    
    if (isNaN(year)) {
      // Invalid input, don't update the form
      return;
    }
    
    if (year < 1800 || year > new Date().getFullYear()) {
      // Year out of range, don't update the form
      return;
    }
    
    // Valid year, update the form
    setFormData({ ...formData, [fieldName]: trimmedValue });
  };

  

  
  // Check if user is authenticated and has proper role
  if (!user) {
    return (
      <div className="space-y-6 p-6">
        <Card className="shadow-lg">
          <CardContent className="pt-6">
            <div className="text-center">
              <h2 className="text-xl font-semibold mb-2">Authentication Required</h2>
              <p className="text-muted-foreground mb-4">Please log in to access the College Management page.</p>
              <Button asChild>
                <a href="/login">Go to Login</a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (user.role !== 'super-admin') {
    return (
      <div className="space-y-6 p-6">
        <Card className="shadow-lg">
          <CardContent className="pt-6">
            <div className="text-center">
              <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
              <p className="text-muted-foreground mb-4">You need super admin privileges to access this page.</p>
              <p className="text-sm text-muted-foreground">Current role: {user.role}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }



  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <motion.h1 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary via-purple-500 to-pink-500"
        >
          College Management
        </motion.h1>
        <div className="flex gap-2">
                      <Button onClick={openCreateDialog} className="bg-primary hover:bg-primary/90">
              <Plus className="h-4 w-4 mr-2" />
              Create New College
            </Button>
        </div>
      </div>

      {/* Search and Filters */}
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Search & Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleSearch} className="flex gap-4">
            <div className="flex-1">
                <Input
                placeholder="Search colleges by name, code, email, phone, or contact person..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full"
                />
            </div>
            <Button type="submit" variant="outline">
              <Search className="mr-2 h-4 w-4" />
              Search
            </Button>
            <Button type="button" variant="outline" onClick={clearFilters}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Clear
            </Button>
          </form>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <Label>City</Label>
              <Select value={filters.city} onValueChange={(value) => handleFilterChange('city', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select city" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all-cities">All Cities</SelectItem>
                  {locations && locations.length > 0 ? (
                    locations.filter(loc => loc.city).map((location, index) => (
                      <SelectItem key={`${location.city}-${index}`} value={location.city}>
                        {location.city}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="none" disabled>No cities available</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>State</Label>
              <Select value={filters.state} onValueChange={(value) => handleFilterChange('state', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select state" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all-states">All States</SelectItem>
                  {locations && locations.length > 0 ? (
                    locations.filter(loc => loc.state).map((location, index) => (
                      <SelectItem key={`${location.state}-${index}`} value={location.state}>
                        {location.state}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="none" disabled>No states available</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Country</Label>
              <Select value={filters.country} onValueChange={(value) => handleFilterChange('country', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select country" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all-countries">All Countries</SelectItem>
                  {locations && locations.length > 0 ? (
                    locations.filter(loc => loc.country).map((location, index) => (
                      <SelectItem key={`${location.country}-${index}`} value={location.country}>
                        {location.country}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="none" disabled>No countries available</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={filters.is_active} onValueChange={(value) => handleFilterChange('is_active', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all-status">All Status</SelectItem>
                  <SelectItem value="true">Active</SelectItem>
                  <SelectItem value="false">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Colleges List */}
      {loading ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((index) => (
            <Card key={index} className="shadow-lg">
              <CardHeader>
                <div className="h-4 w-3/4 bg-muted animate-pulse rounded"></div>
                <div className="h-3 w-1/2 bg-muted animate-pulse rounded"></div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="h-3 w-full bg-muted animate-pulse rounded"></div>
                  <div className="h-3 w-2/3 bg-muted animate-pulse rounded"></div>
                  <div className="h-3 w-1/2 bg-muted animate-pulse rounded"></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <>
                <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>College Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Contact Person</TableHead>
                <TableHead>Departments</TableHead>
                <TableHead>Batches</TableHead>
                <TableHead>No. of Students</TableHead>
                <TableHead>No. of Faculty</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
          {colleges.map((college, index) => (
                <motion.tr
              key={college.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
                  className="hover:bg-muted/50"
                >
                  <TableCell className="font-medium text-primary">
                          {college.name}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                          {college.code}
                  </TableCell>
                  <TableCell>
                    {college.city && college.state ? `${college.city}, ${college.state}` : 'N/A'}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="link"
                      className="p-0 h-auto text-blue-600 hover:text-blue-800"
                      onClick={() => openContactPersonDialog(college)}
                    >
                      View Contact
                    </Button>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="link"
                      className="p-0 h-auto text-blue-600 hover:text-blue-800"
                      onClick={() => openDepartmentsDialog(college)}
                    >
                      {college.departments && Array.isArray(college.departments) ? 
                        college.departments.length : 
                        (college.department_count || 0)
                      }
                    </Button>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="link"
                      className="p-0 h-auto text-blue-600 hover:text-blue-800"
                      onClick={() => openBatchesDialog(college)}
                    >
                      {college.batch_count || 0}
                    </Button>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="link"
                      className="p-0 h-auto text-blue-600 hover:text-blue-800"
                      onClick={() => openStudentsDialog(college)}
                    >
                      {college.student_count || 0}
                    </Button>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="link"
                      className="p-0 h-auto text-blue-600 hover:text-blue-800"
                      onClick={() => openFacultyDialog(college)}
                    >
                    {college.faculty_count || 0}
                    </Button>
                  </TableCell>
                  <TableCell>
                      <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                          onClick={() => openViewDialog(college)}
                        title="View Details"
                        className="h-8 w-8 p-0"
                        >
                        <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                      onClick={() => openEditDialog(college)}
                        title="Edit College"
                        className="h-8 w-8 p-0"
                    >
                        <Edit className="h-4 w-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm" title="Delete College" className="h-8 w-8 p-0">
                            <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete College</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete "{college.name}"? This action cannot be undone.
                            {college.student_count > 0 || college.faculty_count > 0 ? (
                              <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm">
                                ⚠️  This college has active users:
                                {college.student_count > 0 && <div>• {college.student_count} students</div>}
                                {college.faculty_count > 0 && <div>• {college.faculty_count} faculty members</div>}
                                <div className="mt-1 text-xs">
                                  You may need to deactivate users first. Use the "View Details" button to manage users.
                                </div>
                              </div>
                            ) : null}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDeleteCollege(college.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                      </div>
                  </TableCell>
                </motion.tr>
              ))}
            </TableBody>
          </Table>
        </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <Card className="shadow-lg">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    Showing {((pagination.page - 1) * pagination.limit) + 1} to{' '}
                    {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
                    {pagination.total} colleges
                  </div>
                  <div className="flex items-center gap-2">
                    <Select value={pagination.limit.toString()} onValueChange={(value) => handleLimitChange(parseInt(value))}>
                      <SelectTrigger className="w-20">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10">10</SelectItem>
                        <SelectItem value="25">25</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(pagination.page - 1)}
                      disabled={pagination.page === 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm">
                      Page {pagination.page} of {pagination.totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(pagination.page + 1)}
                      disabled={pagination.page === pagination.totalPages}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Create College Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-w-7xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New College</DialogTitle>
            <DialogDescription>
              Add a new college to the platform. Fill in all required fields.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateCollege}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-sm font-medium text-gray-700">College Name *</Label>
              <Input
                id="name"
                value={formData.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    const generatedCode = generateCollegeCode(name);
                    setFormData({ ...formData, name, code: generatedCode });
                  }}
                placeholder="Enter college name"
                className={`h-11 ${formErrors.name ? 'border-red-500' : ''}`}
              />
              {formErrors.name && <p className="text-sm text-red-500">{formErrors.name}</p>}
            </div>
            <div className="space-y-2">
                <Label htmlFor="code">College Code * <span className="text-xs text-gray-500">(Auto-generated)</span></Label>
                <div className="relative">
              <Input
                id="code"
                value={formData.code}
                    readOnly
                    placeholder="Auto-generated from name"
                    className={`${formErrors.code ? 'border-red-500' : 'bg-gray-50'} cursor-not-allowed pr-16`}
                    onClick={handleCodeEditAttempt}
                    title="Click to learn why this field cannot be edited"
                  />
                  {formData.name.trim() && (
                    <button
                      type="button"
                      onClick={() => {
                        const newCode = generateCollegeCode(formData.name);
                        setFormData({ ...formData, code: newCode });
                        toast({
                          title: "Code Regenerated",
                          description: "College code has been regenerated to ensure uniqueness.",
                          variant: "default"
                        });
                      }}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 p-1 hover:bg-gray-200 rounded transition-colors"
                      title="Regenerate code"
                    >
                      <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>
                  )}
                </div>
                {formData.name.trim() && (
                  <div className="space-y-1">
                    <p className="text-xs text-blue-600">
                      Code generated from: <span className="font-mono font-medium">{formData.name}</span>
                    </p>
                    <p className="text-xs text-gray-500">
                      The code is automatically generated and made unique. You cannot edit it manually.
                    </p>
                  </div>
                )}
                {!formData.name.trim() && (
                  <p className="text-xs text-gray-500">
                    Enter a college name above to auto-generate a unique code
                  </p>
                )}
              {formErrors.code && <p className="text-sm text-red-500">{formErrors.code}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="Enter email address"
                className={formErrors.email ? 'border-red-500' : ''}
              />
              {formErrors.email && <p className="text-sm text-red-500">{formErrors.email}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="Enter phone number"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                placeholder="Enter city"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="state">State</Label>
              <Input
                id="state"
                value={formData.state}
                onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                placeholder="Enter state"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="country">Country</Label>
              <Input
                id="country"
                value={formData.country}
                onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                placeholder="Enter country"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="postal_code">Postal Code</Label>
              <Input
                id="postal_code"
                value={formData.postal_code}
                onChange={(e) => setFormData({ ...formData, postal_code: e.target.value })}
                placeholder="Enter postal code"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="website">Website</Label>
              <Input
                id="website"
                value={formData.website}
                onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                placeholder="Enter website URL"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="established_year">Established Year</Label>
              <Input
                id="established_year"
                type="number"
                value={formData.established_year}
                  onChange={(e) => handleYearChange(e.target.value)}
                  placeholder="e.g., 1995"
                className={formErrors.established_year ? 'border-red-500' : ''}
              />
                <p className="text-xs text-gray-500">Optional: Enter a year between 1800 and {new Date().getFullYear()}</p>
              {formErrors.established_year && <p className="text-sm text-red-500">{formErrors.established_year}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="accreditation">Accreditation</Label>
              <Input
                id="accreditation"
                value={formData.accreditation}
                onChange={(e) => setFormData({ ...formData, accreditation: e.target.value })}
                placeholder="Enter accreditation"
              />
            </div>
            {/* Contact Persons Section */}
            <div className="md:col-span-3 space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">Contact Persons *</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addContactPerson}
                  className="flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add Contact
                </Button>
              </div>
              
              {contactPersons.map((contact, index) => (
                <div key={index} className="border rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">
                      Contact {index + 1} {index === 0 && '(Primary)'}
                    </Label>
                    {contactPersons.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeContactPerson(index)}
                        className="text-red-500 hover:text-red-700 h-8 w-8 p-0"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor={`contact_name_${index}`} className="text-xs">Name *</Label>
                      <Input
                        id={`contact_name_${index}`}
                        value={contact.name}
                        onChange={(e) => updateContactPerson(index, 'name', e.target.value)}
                        placeholder="Full name"
                        className={`h-9 ${formErrors[`contact_person_${index}_name`] ? 'border-red-500' : ''}`}
                      />
                      {formErrors[`contact_person_${index}_name`] && (
                        <p className="text-xs text-red-500">{formErrors[`contact_person_${index}_name`]}</p>
                      )}
                    </div>
                    
                    <div className="space-y-1">
                      <Label htmlFor={`contact_phone_${index}`} className="text-xs">Phone *</Label>
                      <Input
                        id={`contact_phone_${index}`}
                        value={contact.phone}
                        onChange={(e) => updateContactPerson(index, 'phone', e.target.value)}
                        placeholder="Phone number"
                        className={`h-9 ${formErrors[`contact_person_${index}_phone`] ? 'border-red-500' : ''}`}
                      />
                      {formErrors[`contact_person_${index}_phone`] && (
                        <p className="text-xs text-red-500">{formErrors[`contact_person_${index}_phone`]}</p>
                      )}
                    </div>
                    
                    <div className="space-y-1">
                      <Label htmlFor={`contact_email_${index}`} className="text-xs">Email *</Label>
                      <Input
                        id={`contact_email_${index}`}
                        type="email"
                        value={contact.email}
                        onChange={(e) => updateContactPerson(index, 'email', e.target.value)}
                        placeholder="Email address"
                        className={`h-9 ${formErrors[`contact_person_${index}_email`] ? 'border-red-500' : ''}`}
                      />
                      {formErrors[`contact_person_${index}_email`] && (
                        <p className="text-xs text-red-500">{formErrors[`contact_person_${index}_email`]}</p>
                      )}
                    </div>
                    
                    <div className="space-y-1">
                      <Label htmlFor={`contact_designation_${index}`} className="text-xs">Designation</Label>
                      <Input
                        id={`contact_designation_${index}`}
                        value={contact.designation}
                        onChange={(e) => updateContactPerson(index, 'designation', e.target.value)}
                        placeholder="e.g., Principal, HOD"
                        className="h-9"
                      />
                    </div>
                  </div>
                </div>
              ))}
              
              {formErrors.contactPersons && (
                <p className="text-sm text-red-500">{formErrors.contactPersons}</p>
              )}
            </div>

            {/* Departments Section */}
            <div className="md:col-span-3 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-base font-semibold">Departments</Label>
                  <p className="text-sm text-gray-600 mt-1">
                    Add custom departments. Codes are auto-generated from names.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCustomDepartments([...customDepartments, { name: '', code: '', description: '' }])}
                  className="flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add Department
                </Button>
              </div>
              
              {customDepartments.map((dept, index) => (
                <div key={index} className="border rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">
                      Department {index + 1}
                    </Label>
                    {customDepartments.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeCustomDepartment(index)}
                        className="text-red-500 hover:text-red-700 h-8 w-8 p-0"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor={`custom_dept_name_${index}`} className="text-xs">Name *</Label>
                      <Input
                        id={`custom_dept_name_${index}`}
                        value={dept.name}
                        onChange={(e) => updateCustomDepartment(index, 'name', e.target.value)}
                        placeholder="Department name"
                        className={`h-9 ${formErrors[`custom_dept_name_${index}`] ? 'border-red-500' : ''}`}
                      />
                      {formErrors[`custom_dept_name_${index}`] && (
                        <p className="text-xs text-red-500">{formErrors[`custom_dept_name_${index}`]}</p>
                      )}
                      {dept.name.trim() && (
                        <p className="text-xs text-blue-600">
                          Code: <span className="font-mono font-medium">{generateDepartmentCode(dept.name)}</span>
                        </p>
                      )}
                    </div>
                    
                    <div className="space-y-1">
                      <Label htmlFor={`custom_dept_code_${index}`} className="text-xs">
                        Code * <span className="text-gray-500">(Auto)</span>
                      </Label>
                      <Input
                        id={`custom_dept_code_${index}`}
                        value={dept.code}
                        onChange={(e) => updateCustomDepartment(index, 'code', e.target.value.toUpperCase())}
                        placeholder="Auto-generated"
                        className={`h-9 ${formErrors[`custom_dept_code_${index}`] ? 'border-red-500' : ''}`}
                      />
                      {formErrors[`custom_dept_code_${index}`] && (
                        <p className="text-xs text-red-500">{formErrors[`custom_dept_code_${index}`]}</p>
                      )}
                    </div>
                    
                    <div className="md:col-span-2 space-y-1">
                      <Label htmlFor={`custom_dept_description_${index}`} className="text-xs">Description</Label>
                      <Textarea
                        id={`custom_dept_description_${index}`}
                        value={dept.description}
                        onChange={(e) => updateCustomDepartment(index, 'description', e.target.value)}
                        placeholder="Brief description"
                        rows={2}
                        className="resize-none h-9"
                      />
                    </div>
                  </div>
                </div>
              ))}
              
              {formErrors.customDepartments && (
                <p className="text-sm text-red-500">{formErrors.customDepartments}</p>
              )}
              
              {/* Selected Departments */}
              {departments.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-gray-700">Selected Default Departments</Label>
                  <div className="space-y-2">
                    {departments.map((dept, index) => (
                      <div key={dept.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <div className="font-medium">{dept.name}</div>
                          <div className="text-sm text-gray-500">{dept.code}</div>
                          {dept.description && (
                            <div className="text-xs text-gray-600">{dept.description}</div>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeDepartment(index)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="md:col-span-3 space-y-2">
              <Label htmlFor="logo_url" className="text-sm font-medium text-gray-700">Logo URL</Label>
              <Input
                id="logo_url"
                value={formData.logo_url}
                onChange={(e) => setFormData({ ...formData, logo_url: e.target.value })}
                placeholder="Enter logo URL"
                className="h-11"
              />
            </div>
            <div className="md:col-span-3 space-y-2">
              <Label htmlFor="address" className="text-sm font-medium text-gray-700">Address</Label>
              <Textarea
                id="address"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder="Enter full address"
                rows={3}
                className="resize-none"
              />
            </div>
            <div className="md:col-span-3 space-y-2">
              <Label htmlFor="description" className="text-sm font-medium text-gray-700">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Enter college description"
                rows={3}
                className="resize-none"
              />
            </div>
          </div>

          {/* Batches Section */}
          <div className="md:col-span-3 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-base font-semibold">Batches</Label>
                <p className="text-sm text-gray-600 mt-1">
                  Add batches to organize students by intake year or class group.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setTempBatches([...tempBatches, { name: '', code: '', description: '' }])}
                className="flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Add Batch
              </Button>
            </div>
            
            {tempBatches.map((batch, index) => (
              <div key={index} className="border rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">
                    Batch {index + 1}
                  </Label>
                  {tempBatches.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const newBatches = tempBatches.filter((_, i) => i !== index);
                        setTempBatches(newBatches);
                      }}
                      className="text-red-500 hover:text-red-700 h-8 w-8 p-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor={`batch_name_${index}`} className="text-xs">Name *</Label>
                    <Input
                      id={`batch_name_${index}`}
                      value={batch.name}
                      onChange={(e) => {
                        const newBatches = [...tempBatches];
                        const name = e.target.value;
                        const generatedCode = generateBatchCode(name);
                        newBatches[index] = { ...batch, name, code: generatedCode };
                        setTempBatches(newBatches);
                      }}
                      placeholder="e.g., 2024-2028, A1"
                      className={`h-9 ${formErrors[`batch_name_${index}`] ? 'border-red-500' : ''}`}
                    />
                    {formErrors[`batch_name_${index}`] && (
                      <p className="text-xs text-red-500">{formErrors[`batch_name_${index}`]}</p>
                    )}
                    {batch.name.trim() && (
                      <p className="text-xs text-blue-600">
                        Code: <span className="font-mono font-medium">{generateBatchCode(batch.name)}</span>
                      </p>
                    )}
                  </div>
                  
                  <div className="space-y-1">
                    <Label htmlFor={`batch_code_${index}`} className="text-xs">
                      Code * <span className="text-gray-500">(Auto)</span>
                    </Label>
                    <Input
                      id={`batch_code_${index}`}
                      value={batch.code}
                      onChange={(e) => {
                        const newBatches = [...tempBatches];
                        newBatches[index] = { ...batch, code: e.target.value.toUpperCase() };
                        setTempBatches(newBatches);
                      }}
                      placeholder="Auto-generated"
                      className={`h-9 ${formErrors[`batch_code_${index}`] ? 'border-red-500' : ''}`}
                    />
                    {formErrors[`batch_code_${index}`] && (
                      <p className="text-xs text-red-500">{formErrors[`batch_code_${index}`]}</p>
                    )}
                  </div>
                  
                  <div className="md:col-span-2 space-y-1">
                    <Label htmlFor={`batch_description_${index}`} className="text-xs">Description</Label>
                    <Textarea
                      id={`batch_description_${index}`}
                      value={batch.description}
                      onChange={(e) => {
                        const newBatches = [...tempBatches];
                        newBatches[index] = { ...batch, description: e.target.value };
                        setTempBatches(newBatches);
                      }}
                      placeholder="Brief description"
                      rows={2}
                      className="resize-none h-9"
                    />
                  </div>
                </div>
              </div>
            ))}
            
            {tempBatches.length === 0 && (
              <div className="text-center py-6 text-muted-foreground border-2 border-dashed border-gray-300 rounded-lg">
                <Calendar className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
                <p className="text-base font-medium">No batches added yet</p>
                <p className="text-sm">Click "Add Batch" to create batches for organizing students</p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              Cancel
            </Button>
              <Button type="submit">
              Create College
            </Button>
          </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit College Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-7xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit College</DialogTitle>
            <DialogDescription>
              Update college information. Required fields are marked with *.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdateCollege}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
              <Label htmlFor="edit-name" className="text-sm font-medium text-gray-700">College Name *</Label>
                <Input
                  id="edit-name"
                  value={formData.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    const generatedCode = generateCollegeCode(name);
                    setFormData({ ...formData, name, code: generatedCode });
                  }}
                  placeholder="Enter college name"
                className={`h-11 ${formErrors.name ? 'border-red-500' : ''}`}
                />
              {formErrors.name && <p className="text-sm text-red-500">{formErrors.name}</p>}
              </div>
              <div className="space-y-2">
              <Label htmlFor="edit-code" className="text-sm font-medium text-gray-700">College Code * <span className="text-xs text-gray-500">(Auto-generated)</span></Label>
                <div className="relative">
                <Input
                  id="edit-code"
                  value={formData.code}
                    readOnly
                    placeholder="Auto-generated from name"
                    className={`${formErrors.code ? 'border-red-500' : 'bg-gray-50'} cursor-not-allowed pr-16`}
                    onClick={handleCodeEditAttempt}
                    title="Click to learn why this field cannot be edited"
                  />
                  {formData.name.trim() && (
                    <button
                      type="button"
                      onClick={() => {
                        const newCode = generateCollegeCode(formData.name);
                        setFormData({ ...formData, code: newCode });
                        toast({
                          title: "Code Regenerated",
                          description: "College code has been regenerated to ensure uniqueness.",
                          variant: "default"
                        });
                      }}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 p-1 hover:bg-gray-200 rounded transition-colors"
                      title="Regenerate code"
                    >
                      <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>
                  )}
                </div>
                {formData.name.trim() && (
                  <div className="space-y-1">
                    <p className="text-xs text-blue-600">
                      Code generated from: <span className="font-mono font-medium">{formData.name}</span>
                    </p>
                    <p className="text-xs text-gray-500">
                      The code is automatically generated and made unique. You cannot edit it manually.
                    </p>
                  </div>
                )}
              {formErrors.code && <p className="text-sm text-red-500">{formErrors.code}</p>}
              </div>
              <div className="space-y-2">
              <Label htmlFor="edit-email" className="text-sm font-medium text-gray-700">Email *</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="Enter email address"
                className={`h-11 ${formErrors.email ? 'border-red-500' : ''}`}
                />
              {formErrors.email && <p className="text-sm text-red-500">{formErrors.email}</p>}
              </div>
              <div className="space-y-2">
              <Label htmlFor="edit-phone" className="text-sm font-medium text-gray-700">Phone</Label>
                <Input
                  id="edit-phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="Enter phone number"
                className="h-11"
                />
              </div>
            <div className="space-y-2">
              <Label htmlFor="edit-city" className="text-sm font-medium text-gray-700">City</Label>
              <Input
                id="edit-city"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                placeholder="Enter city"
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-state" className="text-sm font-medium text-gray-700">State</Label>
              <Input
                id="edit-state"
                value={formData.state}
                onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                placeholder="Enter state"
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-country" className="text-sm font-medium text-gray-700">Country</Label>
              <Input
                id="edit-country"
                value={formData.country}
                onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                placeholder="Enter country"
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-postal_code" className="text-sm font-medium text-gray-700">Postal Code</Label>
              <Input
                id="edit-postal_code"
                value={formData.postal_code}
                onChange={(e) => setFormData({ ...formData, postal_code: e.target.value })}
                placeholder="Enter postal code"
                className="h-11"
              />
            </div>
              <div className="space-y-2">
              <Label htmlFor="edit-website" className="text-sm font-medium text-gray-700">Website</Label>
                <Input
                  id="edit-website"
                  value={formData.website}
                  onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                placeholder="Enter website URL"
                className="h-11"
                />
              </div>
            <div className="space-y-2">
              <Label htmlFor="edit-established_year" className="text-sm font-medium text-gray-700">Established Year</Label>
              <Input
                id="edit-established_year"
                type="number"
                value={formData.established_year}
                onChange={(e) => handleYearChange(e.target.value)}
                placeholder="e.g., 1995"
                className={`h-11 ${formErrors.established_year ? 'border-red-500' : ''}`}
              />
              <p className="text-xs text-gray-500">Optional: Enter a year between 1800 and {new Date().getFullYear()}</p>
              {formErrors.established_year && <p className="text-sm text-red-500">{formErrors.established_year}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-accreditation" className="text-sm font-medium text-gray-700">Accreditation</Label>
              <Input
                id="edit-accreditation"
                value={formData.accreditation}
                onChange={(e) => setFormData({ ...formData, accreditation: e.target.value })}
                placeholder="Enter accreditation"
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-logo_url" className="text-sm font-medium text-gray-700">Logo URL</Label>
              <Input
                id="edit-logo_url"
                value={formData.logo_url}
                onChange={(e) => setFormData({ ...formData, logo_url: e.target.value })}
                placeholder="Enter logo URL"
                className="h-11"
              />
            </div>
            <div className="md:col-span-3 space-y-2">
              <Label htmlFor="edit-address" className="text-sm font-medium text-gray-700">Address</Label>
              <Textarea
                id="edit-address"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder="Enter full address"
                rows={3}
                className="resize-none"
              />
            </div>
            <div className="md:col-span-3 space-y-2">
              <Label htmlFor="edit-description" className="text-sm font-medium text-gray-700">Description</Label>
              <Textarea
                id="edit-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Enter college description"
                rows={3}
                className="resize-none"
              />
            </div>

            {/* Contact Persons Section */}
            <div className="md:col-span-3 space-y-6">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">Contact Persons *</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addContactPerson}
                  className="flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add Contact Person
                </Button>
              </div>
              
              {contactPersons.map((contact, index) => (
                <div key={index} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">
                      Contact Person {index + 1} {index === 0 && '(Primary)'}
                    </Label>
                    {contactPersons.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeContactPerson(index)}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor={`edit_contact_name_${index}`}>Name *</Label>
                      <Input
                        id={`edit_contact_name_${index}`}
                        value={contact.name}
                        onChange={(e) => updateContactPerson(index, 'name', e.target.value)}
                placeholder="Enter contact person name"
                        className={formErrors[`contact_person_${index}_name`] ? 'border-red-500' : ''}
              />
                      {formErrors[`contact_person_${index}_name`] && (
                        <p className="text-sm text-red-500">{formErrors[`contact_person_${index}_name`]}</p>
                      )}
            </div>
                    
            <div className="space-y-2">
                      <Label htmlFor={`edit_contact_phone_${index}`}>Phone *</Label>
              <Input
                        id={`edit_contact_phone_${index}`}
                        value={contact.phone}
                        onChange={(e) => updateContactPerson(index, 'phone', e.target.value)}
                placeholder="Enter contact person phone"
                        className={formErrors[`contact_person_${index}_phone`] ? 'border-red-500' : ''}
              />
                      {formErrors[`contact_person_${index}_phone`] && (
                        <p className="text-sm text-red-500">{formErrors[`contact_person_${index}_phone`]}</p>
                      )}
            </div>
                    
            <div className="space-y-2">
                      <Label htmlFor={`edit_contact_email_${index}`}>Email *</Label>
              <Input
                        id={`edit_contact_email_${index}`}
                type="email"
                        value={contact.email}
                        onChange={(e) => updateContactPerson(index, 'email', e.target.value)}
                placeholder="Enter contact person email"
                        className={formErrors[`contact_person_${index}_email`] ? 'border-red-500' : ''}
              />
                      {formErrors[`contact_person_${index}_email`] && (
                        <p className="text-sm text-red-500">{formErrors[`contact_person_${index}_email`]}</p>
                      )}
              </div>
                    
              <div className="space-y-2">
                      <Label htmlFor={`edit_contact_designation_${index}`}>Designation</Label>
                <Input
                        id={`edit_contact_designation_${index}`}
                        value={contact.designation}
                        onChange={(e) => updateContactPerson(index, 'designation', e.target.value)}
                        placeholder="e.g., Principal, HOD, etc."
                />
              </div>
                  </div>
                </div>
              ))}
              
              {formErrors.contactPersons && (
                <p className="text-sm text-red-500">{formErrors.contactPersons}</p>
              )}
            </div>

            {/* Departments Section */}
            <div className="md:col-span-3 space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-base font-semibold">Departments</Label>
                  <p className="text-sm text-gray-600 mt-1">
                    Choose from common departments or create custom ones. Custom department codes are auto-generated from names.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCustomDepartments([...customDepartments, { name: '', code: '', description: '' }])}
                  className="flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Custom Department
                </Button>
              </div>
              
              {customDepartments.map((dept, index) => (
                <div key={index} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">
                      Custom Department {index + 1}
                    </Label>
                    {customDepartments.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeCustomDepartment(index)}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor={`edit_custom_dept_name_${index}`}>Name *</Label>
                      <Input
                        id={`edit_custom_dept_name_${index}`}
                        value={dept.name}
                        onChange={(e) => updateCustomDepartment(index, 'name', e.target.value)}
                        placeholder="Enter department name"
                        className={formErrors[`custom_dept_name_${index}`] ? 'border-red-500' : ''}
                      />
                      {formErrors[`custom_dept_name_${index}`] && (
                        <p className="text-sm text-red-500">{formErrors[`custom_dept_name_${index}`]}</p>
                      )}
                      {dept.name.trim() && (
                        <p className="text-xs text-blue-600">
                          Code will be: <span className="font-mono font-medium">{generateDepartmentCode(dept.name)}</span>
                        </p>
                      )}
            </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor={`edit_custom_dept_code_${index}`}>
                        Code * 
                        <span className="text-xs text-gray-500 ml-1">(Auto-generated)</span>
                      </Label>
                      <Input
                        id={`edit_custom_dept_code_${index}`}
                        value={dept.code}
                        onChange={(e) => updateCustomDepartment(index, 'code', e.target.value.toUpperCase())}
                        placeholder="Auto-generated from name"
                        className={formErrors[`custom_dept_code_${index}`] ? 'border-red-500' : ''}
                      />
                      {formErrors[`custom_dept_code_${index}`] && (
                        <p className="text-sm text-red-500">{formErrors[`custom_dept_code_${index}`]}</p>
                      )}
                      <p className="text-xs text-gray-500">
                        Code is automatically generated from the department name. You can modify it if needed.
                      </p>
                    </div>
                    
            <div className="md:col-span-2 space-y-2">
                      <Label htmlFor={`edit_custom_dept_description_${index}`}>Description</Label>
              <Textarea
                        id={`edit_custom_dept_description_${index}`}
                        value={dept.description}
                        onChange={(e) => updateCustomDepartment(index, 'description', e.target.value)}
                        placeholder="Enter department description"
                rows={3}
                        className="resize-none"
              />
            </div>
          </div>
                </div>
              ))}
              
              {formErrors.customDepartments && (
                <p className="text-sm text-red-500">{formErrors.customDepartments}</p>
              )}
              
              {/* Selected Departments */}
              {departments.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-gray-700">Selected Default Departments</Label>
                  <div className="space-y-2">
                    {departments.map((dept, index) => (
                      <div key={dept.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <div className="font-medium">{dept.name}</div>
                          <div className="text-sm text-gray-500">{dept.code}</div>
                          {dept.description && (
                            <div className="text-xs text-gray-600">{dept.description}</div>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeDepartment(index)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">
              Update College
            </Button>
          </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* View College Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>College Details</DialogTitle>
            <DialogDescription>
              View detailed information about the college.
            </DialogDescription>
          </DialogHeader>
          {selectedCollege && (
            <>
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <h3 className="font-semibold text-lg text-primary">{selectedCollege.name}</h3>
                      <p className="text-sm text-muted-foreground font-mono">{selectedCollege.code}</p>
                      {getStatusBadge(selectedCollege.is_active)}
                    </div>
                    
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">{selectedCollege.email}</span>
                      </div>
                      {selectedCollege.phone && (
                        <div className="flex items-center gap-2">
                          <Phone className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">{selectedCollege.phone}</span>
                        </div>
                      )}
                      {selectedCollege.website && (
                        <div className="flex items-center gap-2">
                          <Globe className="h-4 w-4 text-muted-foreground" />
                          <a href={selectedCollege.website} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
                            {selectedCollege.website}
                          </a>
                        </div>
                      )}
                      {selectedCollege.address && (
                        <div className="flex items-start gap-2">
                          <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                          <span className="text-sm">{selectedCollege.address}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="text-center p-3 bg-muted rounded-lg">
                        <div className="text-2xl font-bold text-primary">{selectedCollege.total_users || 0}</div>
                        <div className="text-xs text-muted-foreground">Total Users</div>
                      </div>
                      <div className="text-center p-3 bg-muted rounded-lg">
                        <div className="text-2xl font-bold text-primary">{selectedCollege.course_count || 0}</div>
                        <div className="text-xs text-muted-foreground">Courses</div>
                      </div>
                      <div className="text-center p-3 bg-muted rounded-lg">
                        <div className="text-2xl font-bold text-primary">{selectedCollege.faculty_count || 0}</div>
                        <div className="text-xs text-muted-foreground">Faculty</div>
                      </div>
                      <div className="text-center p-3 bg-muted rounded-lg">
                        <div className="text-2xl font-bold text-primary">{selectedCollege.student_count || 0}</div>
                        <div className="text-xs text-muted-foreground">Students</div>
                      </div>
                    </div>
                    
                    {selectedCollege.contact_person && (
                      <div className="space-y-2">
                        <h4 className="font-semibold flex items-center gap-2">
                          <User className="h-4 w-4" />
                          Contact Person
                        </h4>
                        <div className="text-sm space-y-1">
                          <p><strong>Name:</strong> {selectedCollege.contact_person}</p>
                          {selectedCollege.contact_person_phone && (
                            <p><strong>Phone:</strong> {selectedCollege.contact_person_phone}</p>
                          )}
                          {selectedCollege.contact_person_email && (
                            <p><strong>Email:</strong> {selectedCollege.contact_person_email}</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Departments Section */}
                {selectedCollege.departments && selectedCollege.departments.length > 0 && (
                  <div className="space-y-4">
                    <h4 className="font-semibold flex items-center gap-2">
                      <Building className="h-4 w-4" />
                      Departments
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {selectedCollege.departments.map((dept, index) => (
                        <div key={dept.id || index} className="p-3 bg-muted rounded-lg">
                          <div className="font-medium text-primary">{dept.name}</div>
                          <div className="text-sm text-muted-foreground font-mono">{dept.code}</div>
                          {dept.description && (
                            <div className="text-xs text-muted-foreground mt-1">{dept.description}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {(selectedCollege.established_year || selectedCollege.accreditation || selectedCollege.description) && (
                  <div className="space-y-4">
                    {selectedCollege.established_year && (
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm"><strong>Established:</strong> {selectedCollege.established_year}</span>
                      </div>
                    )}
                    {selectedCollege.accreditation && (
                      <div className="flex items-center gap-2">
                        <Award className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm"><strong>Accreditation:</strong> {selectedCollege.accreditation}</span>
                      </div>
                    )}
                    {selectedCollege.description && (
                      <div>
                        <h4 className="font-semibold mb-2">Description</h4>
                        <p className="text-sm text-muted-foreground">{selectedCollege.description}</p>
                      </div>
                    )}
                  </div>
                )}
                
                <div className="text-xs text-muted-foreground">
                  <p><strong>Created:</strong> {formatDate(selectedCollege.created_at)}</p>
                  <p><strong>Last Updated:</strong> {formatDate(selectedCollege.updated_at)}</p>
                </div>
              </div>
              <div className="mt-8">
                <h3 className="font-semibold text-lg mb-2">Students</h3>
                <div className="flex items-center gap-2 mb-2">
                  <Input placeholder="Search students..." value={studentSearch} onChange={handleStudentSearch} />
                </div>
                <div className="overflow-x-auto mb-2">
                  <table className="w-full table-auto border">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="p-2 border">Name</th>
                        <th className="p-2 border">Email</th>
                        <th className="p-2 border">Student ID</th>
                        <th className="p-2 border">Department</th>
                        <th className="p-2 border">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {students.length === 0 ? (
                        <tr><td colSpan={5} className="text-center p-4">No students found.</td></tr>
                      ) : (
                        students.map(s => (
                          <tr key={s.id}>
                            <td className="p-2 border text-blue-600 cursor-pointer hover:underline" onClick={() => navigate(`/profile/${s.id}`)}>{s.name}</td>
                            <td className="p-2 border">{s.email}</td>
                            <td className="p-2 border">{s.student_id}</td>
                            <td className="p-2 border">{s.department}</td>
                            <td className="p-2 border">{s.is_active ? 'Active' : 'Inactive'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-between items-center mb-4">
                  <span>Page {studentPage} of {Math.max(1, Math.ceil(studentTotal / studentsPerPage))}</span>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={studentPage === 1} onClick={() => handleStudentPage(studentPage - 1)}>Prev</Button>
                    <Button size="sm" disabled={studentPage >= Math.ceil(studentTotal / studentsPerPage)} onClick={() => handleStudentPage(studentPage + 1)}>Next</Button>
                  </div>
                </div>
                <h3 className="font-semibold text-lg mb-2">Faculty</h3>
                <div className="flex items-center gap-2 mb-2">
                  <Input placeholder="Search faculty..." value={facultySearch} onChange={handleFacultySearch} />
                </div>
                <div className="overflow-x-auto mb-2">
                  <table className="w-full table-auto border">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="p-2 border">Name</th>
                        <th className="p-2 border">Email</th>
                        <th className="p-2 border">Department</th>
                        <th className="p-2 border">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {faculty.length === 0 ? (
                        <tr><td colSpan={4} className="text-center p-4">No faculty found.</td></tr>
                      ) : (
                        faculty.map(f => (
                          <tr key={f.id}>
                            <td className="p-2 border text-blue-600 cursor-pointer hover:underline" onClick={() => navigate(`/profile/${f.id}`)}>{f.name}</td>
                            <td className="p-2 border">{f.email}</td>
                            <td className="p-2 border">{f.department}</td>
                            <td className="p-2 border">{f.is_active ? 'Active' : 'Inactive'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-between items-center mb-4">
                  <span>Page {facultyPage} of {Math.max(1, Math.ceil(facultyTotal / facultyPerPage))}</span>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={facultyPage === 1} onClick={() => handleFacultyPage(facultyPage - 1)}>Prev</Button>
                    <Button size="sm" disabled={facultyPage >= Math.ceil(facultyTotal / facultyPerPage)} onClick={() => handleFacultyPage(facultyPage + 1)}>Next</Button>
                  </div>
                </div>
              </div>
            </>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsViewDialogOpen(false)}>
              Close
            </Button>
            {selectedCollege && (
              <>
                <Button 
                  variant="destructive" 
                  onClick={() => {
                    if (window.confirm(
                      `⚠️  DEACTIVATE ALL USERS ⚠️\n\n` +
                      `This will deactivate ALL users in ${selectedCollege.name}:\n` +
                      `• Students: ${selectedCollege.student_count || 0}\n` +
                      `• Faculty: ${selectedCollege.faculty_count || 0}\n\n` +
                      `After deactivation, you can delete the college.\n\n` +
                      `Are you sure you want to proceed?`
                    )) {
                      deactivateAllUsersInCollege(selectedCollege.id);
                    }
                  }}
                  disabled={loading}
                >
                  {loading ? 'Processing...' : 'Deactivate All Users'}
                </Button>
              <Button onClick={() => {
                setIsViewDialogOpen(false);
                openEditDialog(selectedCollege);
              }}>
                Edit College
              </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Contact Person Dialog */}
      <Dialog open={isContactPersonDialogOpen} onOpenChange={setIsContactPersonDialogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Contact Person Details</DialogTitle>
            <DialogDescription>
              Contact information for {selectedCollege?.name} - Share or copy contact details
            </DialogDescription>
          </DialogHeader>
          {selectedCollege && (
            <div className="space-y-6">
              {selectedCollege.contact_persons && selectedCollege.contact_persons.length > 0 ? (
                // New format with contact_persons array
                selectedCollege.contact_persons.map((contact, index) => (
                  <div key={contact.id || index} className="border rounded-lg p-6 bg-gradient-to-r from-blue-50 to-indigo-50">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="font-semibold text-primary text-lg">
                        {contact.is_primary ? 'Primary Contact' : `Contact ${index + 1}`}
                      </h4>
                      {contact.is_primary && (
                        <Badge variant="default" className="text-xs">Primary</Badge>
                      )}
                    </div>
                    
                    {/* Contact Information */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                      <div className="space-y-2">
                        <Label className="font-medium">Name</Label>
                        <p className="text-sm text-muted-foreground font-medium">
                          {contact.name || 'N/A'}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label className="font-medium">Phone</Label>
                        <p className="text-sm text-muted-foreground font-medium">
                          {contact.phone || 'N/A'}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label className="font-medium">Email</Label>
                        <p className="text-sm text-muted-foreground font-medium">
                          {contact.email || 'N/A'}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label className="font-medium">Designation</Label>
                        <p className="text-sm text-muted-foreground font-medium">
                          {contact.designation || 'N/A'}
                        </p>
                      </div>
                    </div>

                    {/* Sharing Options */}
                    <div className="border-t pt-4">
                      <h5 className="font-medium text-gray-700 mb-3">Share Contact Information</h5>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        {/* Copy to Clipboard */}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => copyContactToClipboard(contact)}
                          className="flex items-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                          Copy to Clipboard
                        </Button>

                        {/* Generate QR Code */}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => generateContactQRCode(contact)}
                          className="flex items-center gap-2"
                        >
                          <QrCode className="w-4 h-4" />
                          Generate QR Code
                        </Button>

                        {/* Share via Email */}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEmailShare(contact)}
                          className="flex items-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                          Share via Email
                        </Button>

                        {/* Share via WhatsApp */}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleWhatsAppShare(contact)}
                          className="flex items-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.885 3.488"/>
                          </svg>
                          Share via WhatsApp
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              ) : selectedCollege.contact_person ? (
                // Legacy format support
                <div className="border rounded-lg p-6 bg-gradient-to-r from-blue-50 to-indigo-50">
                  <h4 className="font-semibold text-primary text-lg mb-4">Contact Person</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <div className="space-y-2">
                      <Label className="font-medium">Name</Label>
                      <p className="text-sm text-muted-foreground font-medium">
                        {selectedCollege.contact_person || 'N/A'}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label className="font-medium">Phone</Label>
                      <p className="text-sm text-muted-foreground font-medium">
                        {selectedCollege.contact_person_phone || 'N/A'}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label className="font-medium">Email</Label>
                      <p className="text-sm text-muted-foreground font-medium">
                        {selectedCollege.contact_person_email || 'N/A'}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label className="font-medium">Designation</Label>
                      <p className="text-sm text-muted-foreground font-medium">
                        {selectedCollege.contact_person_designation || 'N/A'}
                      </p>
                    </div>
                  </div>

                  {/* Sharing Options for Legacy Format */}
                  <div className="border-t pt-4">
                    <h5 className="font-medium text-gray-700 mb-3">Share Contact Information</h5>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyLegacyContactToClipboard(selectedCollege)}
                        className="flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        Copy to Clipboard
                      </Button>

                      {/* Generate QR Code */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => generateLegacyContactQRCode(selectedCollege)}
                        className="flex items-center gap-2"
                      >
                        <QrCode className="w-4 h-4" />
                        Generate QR Code
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleLegacyEmailShare(selectedCollege)}
                        className="flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        Share via Email
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleLegacyWhatsAppShare(selectedCollege)}
                        className="flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.885 3.488"/>
                        </svg>
                        Share via WhatsApp
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center text-muted-foreground py-8">
                  No contact information available
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsContactPersonDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Email Sharing Input Dialog */}
      <Dialog open={showEmailInput} onOpenChange={setShowEmailInput}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Share Contact via Email</DialogTitle>
            <DialogDescription>
              Enter the recipient's email address to share contact information
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email-recipient">Recipient Email</Label>
              <Input
                id="email-recipient"
                type="email"
                placeholder="Enter email address"
                value={emailRecipient}
                onChange={(e) => setEmailRecipient(e.target.value)}
              />
            </div>
            {activeContact && (
              <div className="text-sm text-muted-foreground">
                <p><strong>Contact:</strong> {activeContact.name}</p>
                <p><strong>Phone:</strong> {activeContact.phone || 'N/A'}</p>
                <p><strong>Email:</strong> {activeContact.email || 'N/A'}</p>
                <p><strong>Designation:</strong> {activeContact.designation || 'N/A'}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeSharingInputs}>
              Cancel
            </Button>
            <Button onClick={sendEmail}>
              Send Email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* WhatsApp Sharing Input Dialog */}
      <Dialog open={showWhatsappInput} onOpenChange={setShowWhatsappInput}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Share Contact via WhatsApp</DialogTitle>
            <DialogDescription>
              Enter the recipient's phone number to share contact information
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="whatsapp-recipient">Recipient Phone Number</Label>
              <Input
                id="whatsapp-recipient"
                type="tel"
                placeholder="Enter phone number (e.g., 911234567890)"
                value={whatsappRecipient}
                onChange={(e) => setWhatsappRecipient(e.target.value)}
              />
            </div>
            {activeContact && (
              <div className="text-sm text-muted-foreground">
                <p><strong>Contact:</strong> {activeContact.name}</p>
                <p><strong>Phone:</strong> {activeContact.phone || 'N/A'}</p>
                <p><strong>Email:</strong> {activeContact.email || 'N/A'}</p>
                <p><strong>Designation:</strong> {activeContact.designation || 'N/A'}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeSharingInputs}>
              Cancel
            </Button>
            <Button onClick={sendWhatsApp}>
              Send WhatsApp
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QR Code Display Dialog */}
      <Dialog open={showQRCode} onOpenChange={setShowQRCode}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Contact QR Code</DialogTitle>
            <DialogDescription>
              Scan this QR code to get contact information
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {qrCodeDataUrl && (
              <div className="flex flex-col items-center space-y-4">
                <img 
                  src={qrCodeDataUrl} 
                  alt="Contact QR Code" 
                  className="w-64 h-64 border rounded-lg"
                />
                {activeContact && (
                  <div className="text-sm text-muted-foreground text-center">
                    <p><strong>Contact:</strong> {activeContact.name}</p>
                    <p><strong>Phone:</strong> {activeContact.phone || 'N/A'}</p>
                    <p><strong>Email:</strong> {activeContact.email || 'N/A'}</p>
                    <p><strong>Designation:</strong> {activeContact.designation || 'N/A'}</p>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeQRCode}>
              Close
            </Button>
            <Button onClick={downloadQRCode} className="flex items-center gap-2">
              <Download className="w-4 h-4" />
              Download QR Code
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Students Dialog */}
      <Dialog open={isStudentsDialogOpen} onOpenChange={setIsStudentsDialogOpen}>
        <DialogContent className="max-w-7xl max-h-[95vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle>Students - {selectedCollege?.name}</DialogTitle>
                <DialogDescription>
                  View all students enrolled in this college
                </DialogDescription>
              </div>
              <Input 
                placeholder="Search students..." 
                value={studentSearch} 
                onChange={handleStudentSearch}
                className="max-w-sm"
              />
            </div>
          </DialogHeader>
          {selectedCollege && (
            <div className="flex flex-col flex-1 min-h-0">
              <div className="flex-1 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="py-2">Name</TableHead>
                      <TableHead className="py-2">Email</TableHead>
                      <TableHead className="py-2">Student ID</TableHead>
                      <TableHead className="py-2">Department</TableHead>
                      <TableHead className="py-2">Status</TableHead>
                      <TableHead className="py-2">Created Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {students.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-4">
                          No students found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      students.map(student => (
                        <TableRow key={student.id} className="hover:bg-muted/50">
                          <TableCell className="py-2 font-medium text-blue-600 cursor-pointer hover:underline" 
                                   onClick={() => navigate(`/profile/${student.id}`)}>
                            {student.name}
                          </TableCell>
                          <TableCell className="py-2 text-sm">{student.email}</TableCell>
                          <TableCell className="py-2 font-mono text-sm">{student.student_id}</TableCell>
                          <TableCell className="py-2 text-sm">{student.department}</TableCell>
                          <TableCell className="py-2">
                            <Badge variant={student.is_active ? "default" : "secondary"} className="text-xs">
                              {student.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-2 text-sm">{formatDate(student.created_at)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              {students.length > 0 && (
                <div className="flex justify-between items-center mt-3 pt-3 border-t">
                  <span className="text-sm text-muted-foreground">
                    Page {studentPage} of {Math.ceil(studentTotal / studentsPerPage)}
                  </span>
                  <div className="flex gap-2">
                    <Button 
                      size="sm" 
                      variant="outline"
                      disabled={studentPage === 1} 
                      onClick={() => handleStudentPage(studentPage - 1)}
                    >
                      Previous
                    </Button>
                    <Button 
                      size="sm" 
                      variant="outline"
                      disabled={studentPage >= Math.ceil(studentTotal / studentsPerPage)} 
                      onClick={() => handleStudentPage(studentPage + 1)}
                    >
                      Next
                    </Button>
                    <Button variant="outline" onClick={() => setIsStudentsDialogOpen(false)}>
                      Close
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Faculty Dialog */}
      <Dialog open={isFacultyDialogOpen} onOpenChange={setIsFacultyDialogOpen}>
        <DialogContent className="max-w-6xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Faculty - {selectedCollege?.name}</DialogTitle>
            <DialogDescription>
              View all faculty members in this college
            </DialogDescription>
          </DialogHeader>
          {selectedCollege && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Input 
                  placeholder="Search faculty..." 
                  value={facultySearch} 
                  onChange={handleFacultySearch}
                  className="max-w-sm"
                />
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {faculty.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8">
                          No faculty members found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      faculty.map(facultyMember => (
                        <TableRow key={facultyMember.id} className="hover:bg-muted/50">
                          <TableCell className="font-medium text-blue-600 cursor-pointer hover:underline" 
                                   onClick={() => navigate(`/profile/${facultyMember.id}`)}>
                            {facultyMember.name}
                          </TableCell>
                          <TableCell>{facultyMember.email}</TableCell>
                          <TableCell>{facultyMember.department}</TableCell>
                          <TableCell>
                            <Badge variant={facultyMember.is_active ? "default" : "secondary"}>
                              {facultyMember.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                          </TableCell>
                          <TableCell>{formatDate(facultyMember.created_at)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              {facultyTotal > facultyPerPage && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">
                    Page {facultyPage} of {Math.ceil(facultyTotal / facultyPerPage)}
                  </span>
                  <div className="flex gap-2">
                    <Button 
                      size="sm" 
                      variant="outline"
                      disabled={facultyPage === 1} 
                      onClick={() => handleFacultyPage(facultyPage - 1)}
                    >
                      Previous
                    </Button>
                                          <Button 
                        size="sm" 
                        variant="outline"
                        disabled={facultyPage >= Math.ceil(facultyTotal / facultyPerPage)} 
                        onClick={() => handleFacultyPage(facultyPage + 1)}
                      >
                        Next
                      </Button>
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsFacultyDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Departments Dialog */}
      <Dialog open={isDepartmentsDialogOpen} onOpenChange={setIsDepartmentsDialogOpen}>
        <DialogContent className="max-w-7xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Departments - {selectedCollege?.name}</DialogTitle>
            <DialogDescription>
              Add, edit, and manage departments for this college. Choose from common departments or create custom ones.
            </DialogDescription>
          </DialogHeader>
          {selectedCollege && (
            <div className="space-y-8">
              {/* Current Departments Display */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Current Departments</h3>
                  <Button onClick={() => {
                    setEditingDepartmentIndex(-1); // Use -1 to indicate new department
                    setNewDepartment({ name: '', code: '', description: '' });
                  }}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Department
                  </Button>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {/* Add New Department Card */}
                  {editingDepartmentIndex === -1 && (
                    <Card className="p-3 border-dashed border-2 border-primary/30 bg-primary/5">
                      <div className="space-y-2">
                        <Input
                          value={newDepartment.name}
                          onChange={(e) => setNewDepartment(prev => ({ ...prev, name: e.target.value }))}
                          placeholder="Department Name"
                          className="h-8 text-sm"
                        />
                        <Input
                          value={newDepartment.code}
                          onChange={(e) => setNewDepartment(prev => ({ ...prev, code: e.target.value.toUpperCase() }))}
                          placeholder="Department Code"
                          className="h-8 text-sm"
                        />
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            onClick={handleAddDepartment}
                            disabled={!newDepartment.name || !newDepartment.code}
                            className="h-6 px-2 text-xs"
                          >
                            Add
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditingDepartmentIndex(null);
                              setNewDepartment({ name: '', code: '', description: '' });
                            }}
                            className="h-6 px-2 text-xs"
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </Card>
                  )}
                  
                  {selectedCollege.departments && selectedCollege.departments.length > 0 && selectedCollege.departments.map((dept, index) => (
                      <Card key={index} className="p-3 hover:shadow-md transition-shadow">
                        {editingDepartmentIndex === index ? (
                          <div className="space-y-2">
                            <Input
                              value={newDepartment.name}
                              onChange={(e) => setNewDepartment(prev => ({ ...prev, name: e.target.value }))}
                              placeholder="Department Name"
                              className="h-8 text-sm"
                            />
                            <Input
                              value={newDepartment.code}
                              onChange={(e) => setNewDepartment(prev => ({ ...prev, code: e.target.value.toUpperCase() }))}
                              placeholder="Department Code"
                              className="h-8 text-sm"
                            />
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                onClick={handleUpdateDepartment}
                                disabled={!newDepartment.name || !newDepartment.code}
                                className="h-6 px-2 text-xs"
                              >
                                Save
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setEditingDepartmentIndex(null);
                                  setNewDepartment({ name: '', code: '', description: '' });
                                }}
                                className="h-6 px-2 text-xs"
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <h4 className="font-semibold text-base mb-1 truncate">{dept.name}</h4>
                              <div className="flex items-center gap-2">
                                <p className="font-mono text-xs text-muted-foreground">{dept.code}</p>
                                <span className="text-xs text-muted-foreground">
                                  ({departmentStudentCounts[dept.name] || 0} students)
                                </span>
                              </div>
                            </div>
                            <div className="flex gap-1 ml-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleViewDepartmentStudents(dept)}
                                className="text-green-600 hover:text-green-700 hover:bg-green-50 h-6 w-6 p-0"
                                title="View Students"
                              >
                                <Users className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleEditDepartment(index)}
                                className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 h-6 w-6 p-0"
                                title="Edit Department"
                              >
                                <Edit className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleRemoveCommonDepartment(index)}
                                className="text-red-600 hover:text-red-700 hover:bg-red-50 h-6 w-6 p-0"
                                title="Delete Department"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </Card>
                    ))}
                </div>
                
                {(!selectedCollege.departments || selectedCollege.departments.length === 0) && editingDepartmentIndex !== -1 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Building2 className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                    <p>No departments found for this college.</p>
                    <p className="text-sm">Click "Add Department" to get started.</p>
                  </div>
                )}
              </div>






            </div>
          )}
          <DialogFooter className="flex justify-between">
            <div className="text-sm text-muted-foreground">
              {selectedCollege?.departments?.length || 0} departments in this college
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleCloseDepartmentsDialog}>
                Cancel
              </Button>
              <Button onClick={handleSaveAllDepartments}>
                Save Changes
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batches Dialog */}
      <Dialog open={isBatchesDialogOpen} onOpenChange={setIsBatchesDialogOpen}>
        <DialogContent className="max-w-7xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Batches - {selectedCollege?.name}</DialogTitle>
            <DialogDescription>
              Add, edit, and manage batches for this college. Batches help organize students by intake year or class group.
            </DialogDescription>
          </DialogHeader>
          {selectedCollege && (
            <div className="space-y-8">
              {/* Current Batches Display */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Current Batches</h3>
                  <Button onClick={() => {
                    setEditingBatchIndex(-1); // Use -1 to indicate new batch
                    setNewBatch({ name: '', code: '', description: '', start_year: '', end_year: '' });
                  }}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Batch
                  </Button>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {/* Add New Batch Card */}
                  {editingBatchIndex === -1 && (
                    <Card className="p-3 border-dashed border-2 border-primary/30 bg-primary/5">
                      <div className="space-y-2">
                        <Input
                          value={newBatch.name}
                          onChange={(e) => setNewBatch(prev => ({ ...prev, name: e.target.value }))}
                          placeholder="Batch Name"
                          className="h-8 text-sm"
                        />
                        <Input
                          value={newBatch.code}
                          onChange={(e) => setNewBatch(prev => ({ ...prev, code: e.target.value.toUpperCase() }))}
                          placeholder="Batch Code"
                          className="h-8 text-sm"
                        />
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            onClick={handleAddBatch}
                            disabled={!newBatch.name || !newBatch.code}
                            className="h-6 px-2 text-xs"
                          >
                            Add
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditingBatchIndex(null);
                              setNewBatch({ name: '', code: '', description: '', start_year: '', end_year: '' });
                            }}
                            className="h-6 px-2 text-xs"
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </Card>
                  )}
                  
                  {tempBatches && tempBatches.length > 0 && tempBatches.map((batch, index) => (
                      <Card key={batch.id} className="p-3 hover:shadow-md transition-shadow">
                        {editingBatchIndex === index ? (
                          <div className="space-y-2">
                            <Input
                              value={newBatch.name}
                              onChange={(e) => setNewBatch(prev => ({ ...prev, name: e.target.value }))}
                              placeholder="Batch Name"
                              className="h-8 text-sm"
                            />
                            <Input
                              value={newBatch.code}
                              onChange={(e) => setNewBatch(prev => ({ ...prev, code: e.target.value.toUpperCase() }))}
                              placeholder="Batch Code"
                              className="h-8 text-sm"
                            />
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                onClick={handleUpdateBatch}
                                disabled={!newBatch.name || !newBatch.code}
                                className="h-6 px-2 text-xs"
                              >
                                Save
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setEditingBatchIndex(null);
                                  setNewBatch({ name: '', code: '', description: '', start_year: '', end_year: '' });
                                }}
                                className="h-6 px-2 text-xs"
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                                                  ) : (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <h4 className="font-semibold text-base truncate">{batch.name}</h4>
                                <div className="flex gap-1 ml-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleViewBatchStudents(batch)}
                                    className="text-green-600 hover:text-green-700 hover:bg-green-50 h-6 w-6 p-0"
                                    title="View Students"
                                  >
                                    <Users className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleEditBatch(index)}
                                    className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 h-6 w-6 p-0"
                                    title="Edit Batch"
                                  >
                                    <Edit className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleDeleteBatch(batch.id)}
                                    className="text-red-600 hover:text-red-700 hover:bg-red-50 h-6 w-6 p-0"
                                    title="Delete Batch"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>
                              <div className="flex items-center justify-between">
                                <p className="font-mono text-xs text-muted-foreground">{batch.code}</p>
                                <span className="text-xs text-muted-foreground">
                                  ({batchStudentCounts[batch.name] || 0} students)
                                </span>
                              </div>
                            </div>
                          )}
                      </Card>
                    ))}
                </div>
                
                {(!tempBatches || tempBatches.length === 0) && editingBatchIndex !== -1 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Calendar className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                    <p>No batches found for this college.</p>
                    <p className="text-sm">Click "Add Batch" to get started.</p>
                  </div>
                )}
              </div>




            </div>
          )}
          <DialogFooter className="flex justify-between">
            <div className="text-sm text-muted-foreground">
              {tempBatches?.length || 0} batches in this college
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleCloseBatchesDialog}>
                Close
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Students Dialog */}
      <Dialog open={isViewStudentsDialogOpen} onOpenChange={setIsViewStudentsDialogOpen}>
        <DialogContent className="max-w-7xl max-h-[95vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Students in {viewStudentsData.type === 'department' ? 'Department' : 'Batch'}: {viewStudentsData.name}
            </DialogTitle>
            <DialogDescription>
              View all students in this {viewStudentsData.type === 'department' ? 'department' : 'batch'}.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {loading ? (
              <div className="flex justify-center items-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : viewStudentsData.students.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="py-2">Student ID</TableHead>
                      <TableHead className="py-2">Name</TableHead>
                      <TableHead className="py-2">Email</TableHead>
                      <TableHead className="py-2">Phone</TableHead>
                      <TableHead className="py-2">Joining Year</TableHead>
                      <TableHead className="py-2">Current Year</TableHead>
                      <TableHead className="py-2">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {viewStudentsData.students.map((student) => (
                      <TableRow key={student.id} className="hover:bg-muted/50">
                        <TableCell className="py-2 font-mono text-sm">{student.student_id}</TableCell>
                        <TableCell className="py-2 font-medium">{student.name}</TableCell>
                        <TableCell className="py-2 text-sm">{student.email}</TableCell>
                        <TableCell className="py-2 text-sm">{student.phone || 'N/A'}</TableCell>
                        <TableCell className="py-2 text-sm">{student.joining_year}</TableCell>
                        <TableCell className="py-2 text-sm">{student.current_year || 'N/A'}</TableCell>
                        <TableCell className="py-2">
                          <Badge variant={student.status === 'active' ? 'default' : 'secondary'}>
                            {student.status || 'active'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                <p>No students found in this {viewStudentsData.type === 'department' ? 'department' : 'batch'}.</p>
              </div>
            )}
          </div>
          
          <DialogFooter className="flex flex-col gap-4">
            {/* Pagination Controls */}
            {viewStudentsPagination.totalPages > 1 && (
              <div className="flex items-center justify-between w-full">
                <div className="text-sm text-muted-foreground">
                  Showing {((viewStudentsPagination.page - 1) * viewStudentsPagination.limit) + 1} to {Math.min(viewStudentsPagination.page * viewStudentsPagination.limit, viewStudentsPagination.total)} of {viewStudentsPagination.total} students
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleViewStudentsPageChange(viewStudentsPagination.page - 1)}
                    disabled={viewStudentsPagination.page <= 1}
                    className="h-8 px-3"
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground px-2">
                    Page {viewStudentsPagination.page} of {viewStudentsPagination.totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleViewStudentsPageChange(viewStudentsPagination.page + 1)}
                    disabled={viewStudentsPagination.page >= viewStudentsPagination.totalPages}
                    className="h-8 px-3"
                  >
                    Next
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}
            
            <div className="flex justify-between w-full">
              <div className="text-sm text-muted-foreground">
                {viewStudentsPagination.total} students in this {viewStudentsData.type === 'department' ? 'department' : 'batch'}
              </div>
              <Button variant="outline" onClick={() => setIsViewStudentsDialogOpen(false)}>
                Close
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CollegeManagementPage; 

