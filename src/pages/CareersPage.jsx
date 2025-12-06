import React from 'react';
import { Button } from '@/components/ui/button';
import { Briefcase } from 'lucide-react';

const CareersPage = () => {
    const positions = [
        {
            title: "Senior Full Stack Engineer",
            department: "Engineering",
            location: "Remote / SF",
            type: "Full-time"
        },
        {
            title: "Product Designer",
            department: "Design",
            location: "Remote",
            type: "Full-time"
        },
        {
            title: "Customer Success Manager",
            department: "Sales",
            location: "New York",
            type: "Full-time"
        }
    ];

    return (
        <div className="min-h-screen bg-white pt-24 pb-12">
            <div className="container mx-auto px-6">
                <div className="text-center max-w-3xl mx-auto mb-16">
                    <h1 className="text-4xl font-bold text-slate-900 mb-6">Careers at EduHorizon</h1>
                    <p className="text-xl text-slate-500">
                        Join us in building the operating system for modern education.
                    </p>
                </div>

                <div className="max-w-4xl mx-auto">
                    <h2 className="text-2xl font-bold text-slate-900 mb-8 flex items-center gap-2">
                        <Briefcase className="h-6 w-6 text-blue-600" /> Open Positions
                    </h2>

                    <div className="space-y-4">
                        {positions.map((job, index) => (
                            <div key={index} className="flex flex-col md:flex-row items-center justify-between p-6 bg-slate-50 rounded-xl border border-slate-100 hover:border-blue-200 transition-colors">
                                <div className="mb-4 md:mb-0 text-center md:text-left">
                                    <h3 className="text-lg font-bold text-slate-900">{job.title}</h3>
                                    <div className="flex items-center gap-4 text-sm text-slate-500 mt-1 justify-center md:justify-start">
                                        <span>{job.department}</span>
                                        <span>•</span>
                                        <span>{job.location}</span>
                                        <span>•</span>
                                        <span>{job.type}</span>
                                    </div>
                                </div>
                                <Button variant="outline" className="border-blue-200 text-blue-600 hover:bg-blue-50">
                                    Apply Now
                                </Button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CareersPage;
