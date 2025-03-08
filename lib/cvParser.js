export function parseCVContent(content) {
  const sections = {
    personalInfo: {
      name: '',
      email: '',
      phone: '',
      address: '',
      nic: '',
      linkedin: '',
      github: ''
    },
    education: [],
    qualifications: [],
    projects: []
  };

  const lines = content.split('\n').map(line => line.trim()).filter(line => line);

  let currentSection = '';
  let foundEmail = false;
  let foundAddress = false;
  let inReferences = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect section headers
    if (line.toUpperCase().includes('EDUCATION')) {
      currentSection = 'education';
      continue;
    } else if (line.toUpperCase().includes('CERTIFICATE') || 
               line.toUpperCase().includes('DIPLOMA') || 
               line.toUpperCase().includes('HND') || 
               line.toUpperCase().includes('ADVANCED LEVEL') || 
               line.toUpperCase().includes('A/L')) {
      currentSection = 'education';
      continue;
    } else if (line.toUpperCase().includes('PROFESSIONAL EXPERIENCE') || 
               line.toUpperCase().includes('EXPERIENCE')) {
      currentSection = 'qualifications';
      continue;
    } else if (line.toUpperCase().includes('PROJECTS')) {
      currentSection = 'projects';
      continue;
    } else if (line.toUpperCase().includes('REFERENCES')) {
      inReferences = true;
      continue;
    }

    if (inReferences) continue;

    // Extract personal information
    if (line.includes('@') && !foundEmail) {
      sections.personalInfo.email = line;
      foundEmail = true;
    } else if (line.match(/^[0-9]{10}$/)) {
      sections.personalInfo.phone = line;
    } else if (line.includes('linkedin.com')) {
      sections.personalInfo.linkedin = line;
    } else if (line.includes('github.com')) {
      sections.personalInfo.github = line;
    } else if (line.match(/^[0-9]{9}[vV]$/)) {
      sections.personalInfo.nic = line;
    } else if (line.includes(',') && line.length > 30 && !foundAddress) {
      sections.personalInfo.address = line;
      foundAddress = true;
    } else if (!sections.personalInfo.name && line.length > 3 && !line.includes('@')) {
      sections.personalInfo.name = line;
    }

    // Process education entries
    if (currentSection === 'education' && line.length > 0) {
      // Check for Advanced Level entries
      if (line.includes('Advance') || line.includes('A/L')) {
        let subjectStream = '';
        let description = '';
        let period = '';
        let j = i + 1;
        
        // Get period, subject stream and description
        while (j < lines.length && 
               !lines[j].includes('BSc') && 
               !lines[j].includes('Bachelor') && 
               !lines[j].includes('Degree') &&
               !lines[j].includes('Certificate') &&
               !lines[j].includes('Course') &&
               !lines[j].includes('Diploma') &&
               !lines[j].includes('HND')) {
          if (lines[j].match(/^\d{4}$/)) {
            period = lines[j];
          } else if (lines[j].includes('Bio-Science') || lines[j].includes('Bio Science')) {
            subjectStream = lines[j];
          } else if (lines[j].includes('subjects')) {
            description = lines[j];
          }
          j++;
        }

        const educationEntry = {
          type: 'A/L',
          examination: 'Advance Level',
          period: period || '-',
          subjectStream: subjectStream || '-',
          description: description || '-'
        };
        sections.education.push(educationEntry);
        i = j - 1; // Update i to skip processed lines
        continue;
      }

      // Check for Degree entries
      if (line.includes('BSc') || line.includes('Bachelor') || line.includes('Degree')) {
        // Collect degree name from next lines until we find the institution
        let degreeName = line;
        let j = i + 1;
        while (j < lines.length && 
               !lines[j].includes('Institute') && 
               !lines[j].includes('University')) {
          degreeName += ' ' + lines[j];
          j++;
        }

        // Collect institution name from next lines
        let institution = lines[j];
        j++;
        while (j < lines.length && 
               !lines[j].match(/\d{4}/) && 
               !lines[j].includes('Advance') && 
               !lines[j].includes('A/L')) {
          institution += ' ' + lines[j];
          j++;
        }

        const period = lines[j] || '-';
        const location = lines[j + 1] || '-';
        const gpa = lines[j + 2] || '-';

        const educationEntry = {
          type: 'Degree',
          degree: degreeName,
          institution: institution,
          period: period,
          location: location,
          gpa: gpa
        };
        sections.education.push(educationEntry);
        i = j + 2; // Update i to skip processed lines
        continue;
      }

      // Check for Certificate/Course entries
      if (line.includes('Certificate') || line.includes('Course') || line.includes('Diploma') || line.includes('HND')) {
        // Collect certificate name from next lines until we find the institution
        let certificateName = line;
        let j = i + 1;
        while (j < lines.length && 
               !lines[j].includes('Institute') && 
               !lines[j].includes('University')) {
          certificateName += ' ' + lines[j];
          j++;
        }

        const institution = lines[j] || '-';
        const period = lines[j + 1] || '-';
        const location = lines[j + 2] || '-';

        const educationEntry = {
          type: 'Certificate',
          name: certificateName,
          institution: institution,
          period: period,
          location: location
        };
        sections.education.push(educationEntry);
        i = j + 2; // Update i to skip processed lines
        continue;
      }
    }

    // Process qualifications/experience entries
    if (currentSection === 'qualifications' && line.length > 0) {
      // Check for internship or job titles
      if (line.includes('Intern') || line.includes('Engineer') || line.includes('Developer')) {
        // Collect company name from next lines until we find a date
        let companyName = '';
        let j = i + 1;
        while (j < lines.length && !lines[j].match(/\d{4}/)) {
          companyName += (companyName ? ' ' : '') + lines[j];
          j++;
        }

        // Find the period (date)
        const period = lines[j] || '-';
        const location = lines[j + 1] || '-';

        // Collect description from subsequent lines until we hit another title or section
        let description = '';
        j = j + 2;
        while (j < lines.length && 
               !lines[j].includes('Intern') && 
               !lines[j].includes('Engineer') && 
               !lines[j].includes('Developer') &&
               !lines[j].toUpperCase().includes('PROJECTS') &&
               !lines[j].toUpperCase().includes('EDUCATION')) {
          description += (description ? '\n' : '') + lines[j];
          j++;
        }

        const qualificationEntry = {
          title: line,
          company: companyName,
          period: period,
          location: location,
          description: description
        };

        sections.qualifications.push(qualificationEntry);
        i = j - 1; // Update i to skip processed lines
      }
    }

    // Process projects entries
    if (currentSection === 'projects' && line.length > 0) {
      if (line.includes('Framework') || line.includes('System') || line.includes('Application')) {
        const projectEntry = {
          name: line,
          technology: lines[i + 1] || '-',
          description: lines[i + 2] || '-',
          link: lines[i + 3] || '-'
        };
        sections.projects.push(projectEntry);
        i += 3;
      }
    }
  }

  return sections;
}
