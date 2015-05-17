require 'jasmine'
require 'coffee-script'
require 'fileutils'
require 'rake/packagetask'
load 'jasmine/tasks/jasmine.rake'

APP_FILE  = 'app.rb'
APP_CLASS = 'App'
require 'sinatra/assetpack/rake'


namespace :specs do
  desc "Runs Jasmine JS specs from browser"
  task :server do
    system 'rake assets:clean'
    system 'rake assetpack:build'
    system 'rake jasmine'
  end
end

namespace :specs do
  desc 'Runs Jasmine JS specs headless'
  task :ci do
    system 'rake assets:clean'
    system 'rake assetpack:build'
    system 'rake jasmine:ci'
  end
end

namespace :assets do
  desc 'Cleans output from assetpack:build'
  task :clean do
    root = File.dirname(__FILE__)
    Dir.glob(File.join(root, 'public')).each do |f|
      puts "Deleting #{f}"
      if File.directory?(f)
        FileUtils.rm_rf(f)
      end
    end
  end
end

namespace :app do
  desc 'Runs application'
  task :run do
    system 'rake assets:clean'
    system 'rackup -p 4567'
  end
end


namespace :package do

  desc 'Build base application'
  task :build do
    root = File.dirname(__FILE__)
    #Dir.glob(File.join(root, 'app/**')).each do |f|
    system "rm zipfile.zip"
    Dir.glob('app/**').each do |f|
      puts "Packaging #{f}"
      system "zip -r zipfile.zip #{f}"
    end

  end

#   puts "about to package"
# # see http://rake.rubyforge.org/classes/Rake/PackageTask.html
#   Rake::PackageTask.new("all_jpgs", "0.0.1") do |p|
#     p.need_zip = true
#     p.package_files.include("app/**/*.*", "lib/**/*.*")
#   end
#   puts "after package"


end


