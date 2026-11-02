PDS_VERSION_ID     = PDS3                                                     
RECORD_TYPE        = "STREAM"                                                 
                                                                              
OBJECT             = TEXT                                                     
  PUBLICATION_DATE = 2018-04-09                                               
  NOTE             = "AAREADME file for the Apollo 17 landing site map (1:15000)"             
END_OBJECT         = TEXT                                                     
                                                                              
END                                                                           
                                                                              
Introduction                                                                  
=============                                                                  
                                                                              
  This is an (ortho-) mosaic map and digital elevation model (DEM) of
  the Apollo 17 landing site (L15K 20.2/30.7East COMT). The map 
  includes nomenclature, elevation contours, the astronauts' major 
  geology stops, and rover traverses. It covers an area of about 
  14 km x 12 km of the Taurus-Littrow Valley, from 30.4294°E to 
  30.9162°E in longitude and from 19.9771°N to 20.3639°N in latitude.
  
  The image component of the map is an orthomosaic (0.5 m/pixel) that
  was created from images provided by the Lunar Reconnaissance Orbiter
  Camera (LROC) Narrow Angle Camera (NAC). Orthorectification of the
  images was based on a DEM (1.5 m/pixel) which was processed from 
  LROC NAC stereo pairs. The DEM was also used to derive elevation 
  contour lines, which were included in the map to indicate topography.
  The DEM and the orthomosaic are available as related products.
  
  We also determined the locations from where the Apollo 17 astronauts
  acquired station panoramas, and where they deployed ALSEP instruments.
  For this, we jointly analyzed the on-site Hasselblad photographs and
  the LROC NAC orthomosaic and registered the surface images to the 
  orbital image. The determined camera and instrument positions were
  mapped in large scale station maps and are provided as ancillary 
  cartographic products. More details on the localization approach 
  and the station maps are provided by Haase et al. (2018).

  Reference: Haase, I., Wählisch, M., Gläser, P., Oberst, J., Robinson, 
  M. S., Coordinates and Maps  of the Apollo 17 Landing Site, 
  Earth and Space Science, submitted
                                                                              
Volume Format                                                                 
=============                                                                 
                                                                              
  This volume has been formatted according to the ISO-9660 level 2            
  Interchange Standard for directories and file names.                        
                                                                              
                                                                              
File Formats                                                                  
============                                                                  
                                                                              
  All text documents and other meta information files such as                 
  descriptions, PDS object definitions and detached PDS labels are            
  stream format files, with a carriage return (ASCII 13) and a line           
  feed character (ASCII 10) at the end of the record.  This allows            
  the files to be read by various operating systems.                          
                                                                              
                                                                              
Volume Contents                                                               
===============                                                               
                                                                              
  Files on this volume are organized into a set of subdirectories             
  below the top-level directory.  The following table shows the               
  structure and content of these directories. In the table, directory         
  names are enclosed in square brackets ([]).  See the *INFO.TXT files        
  in some directories for specific information on the files in that           
  directory. In the directory descriptions below, "usable" refers to 
  those images considered usable by the Apollo mission teams.                                                                  
                                                                              
  [TOP-LEVEL-DIRECTORY]                                                       
  |                                                                           
  |-- AAREADME.TXT         This file                                          
  |                                                                           
  |-- VOLDESC.CAT          Description of the contents of this volume         
  |                                                                           
  |--[CATALOG]             Directory containing PDS catalog objects           
  |  |                                                                        
  |  |-- DSMAP.CAT         Map projections used for data files
  |  |-- PERSON.CAT        Description of primary personnel who created this volume   
  |  |-- REF.CAT           List of publications mentioned in catalog files    
  |                                                                           
  |--[DATA]                Directory containing the data products             
  |  |                                                                        
  |  |-- APOLLO17_CONTROLPOINTS_2018.LBL
         PDS detached label that describes the file APOLLO17_CONTROLPOINTS_2018.TAB.
         List describes the correlation between the index number in  
         and the names used within the maps.
  |  |-- APOLLO17_DTM_150CM.IMG           Data and label files for usable images from Apollo 17, Revolution 13
  |  |-- APOLLO17_M168000580RE_25CM.IMG   Data and label files for usable images from Apollo 17, Revolution 14
  |  |-- APOLLO17_ORTHOMOSAIC_50CM.IMG    Data and label files for usable images from Apollo 17, Revolution 15
  |
  |--[DOCUMENT]            Directory of relevant documents                    
  |  |                                                                        
  |  |-- APOLLO17_landing_site_map_15000.docx Description for Landing map.      
  |  |-- TaurusLittrowValley_DEM_150cm.docx Decription for created digitial elevation model 
  |  |-- TaurusLittrowValley_Orthomosaic_50cm.docx Description fpr created orthomosaic     
  |                                                                          
  |--[EXTRAS]         Directory containing GIS file and available browse images
  |  |
  |  |--[GIS] Directory containing GIS-compatible formats for available DATA with this
              archive including GeoTIFF formmatted versions for the digital elevation
              models (DEM/DTM), orthomosaics, and way points and traverse lines (shapefile)
  |  |--[BROWSE] Directory with simple JPEG represenations for the images
                                                                              
Whom to Contact for Information                                               
===============================                                               
                                                                              
For questions concerning this volume set, contact:                            

  Lisa Gaddis 
  PDS Imaging Node, USGS
  2255 N. Gemini Drive
  Flagstaff, AZ  86004
  (928)556-7100                                                              
                                                                              
  Web Site:  https://pds-imaging.jpl.nasa.gov/
  E-mail:    lgaddis@usgs.gov
                                    
