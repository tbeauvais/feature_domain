require 'sinatra/base'
require 'sinatra/assetpack'
require 'slim'
require 'coffee-script'
require 'pry'

class App < Sinatra::Base

  set :root, File.dirname(__FILE__) # You must set app root

  register Sinatra::AssetPack

  assets do
    serve '/js',     :from => 'app/js'
    serve '/css',    :from => 'app/css'
    serve '/images', :from => 'app/images'

    js :app, [
        '/js/vendor/jquery-2.1.1.js',
        '/js/vendor/jquery-ui.js',
        '/js/vendor/bootstrap.js',
        '/js/vendor/angular.js',
        '/js/vendor/sortable.js',
        '/js/vendor/underscore.js',
        '/js/application.js',
        '/js/*.js'
    ]

    css :app, [
        '/css/*.css',
        '/css/vendor/*.css'
    ]

  end

  get '/' do
    slim :index
  end

end




